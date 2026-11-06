import { Inject, Injectable } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import { DB, Db } from '../db/db.module';
import { cities, City, countries, Country, Place, places, Region, regions, Stay, stays, Tour, tourCities, tours } from '../db/schema';

export type TourIndexed = Tour & {
  cityIds: string[];
  cityId: string;
  countryId: string;
  regionId: string;
  countryIds: string[];
  regionIds: string[];
};

export type CatalogSnapshot = {
  loadedAt: number;
  regions: Region[];
  regionById: Map<string, Region>;
  countries: Country[];
  countryById: Map<string, Country>;
  cities: City[];
  cityById: Map<string, City>;
  citiesByCountry: Map<string, City[]>;
  places: Place[];
  placeById: Map<string, Place>;
  placesByCity: Map<string, Place[]>;
  stays: Stay[];
  stayById: Map<string, Stay>;
  staysByCity: Map<string, Stay[]>;
  /** Published tours only */
  tours: TourIndexed[];
  tourById: Map<string, TourIndexed>;
  toursByCity: Map<string, TourIndexed[]>;
  toursByCountry: Map<string, TourIndexed[]>;
};

const group = <T, K>(items: T[], key: (t: T) => K) => {
  const m = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(it);
  }
  return m;
};

/**
 * Single source of truth for the catalog (PDF §1, §9). Home, Countries, Favorites and the AI
 * planner all read the same snapshot, so a tour has the same id/price everywhere.
 * The catalog is small and read-heavy, so it is held in memory and refreshed every TTL
 * or immediately after admin writes.
 */
@Injectable()
export class CatalogStore {
  private snap: CatalogSnapshot | null = null;
  private loading: Promise<CatalogSnapshot> | null = null;
  private readonly ttlMs = Number(process.env.CATALOG_CACHE_TTL_MS ?? 60_000);

  constructor(@Inject(DB) private readonly db: Db) {}

  invalidate() {
    this.snap = null;
  }

  async get(): Promise<CatalogSnapshot> {
    if (this.snap && Date.now() - this.snap.loadedAt < this.ttlMs) return this.snap;
    if (!this.loading) {
      this.loading = this.load().finally(() => (this.loading = null));
    }
    return this.loading;
  }

  private async load(): Promise<CatalogSnapshot> {
    const [rRegions, rCountries, rCities, rPlaces, rStays, rTours, rTourCities] = await Promise.all([
      this.db.select().from(regions).orderBy(asc(regions.sortOrder)),
      this.db.select().from(countries).orderBy(asc(countries.name)),
      this.db.select().from(cities).orderBy(asc(cities.name)),
      this.db.select().from(places).orderBy(asc(places.name)),
      this.db.select().from(stays).orderBy(asc(stays.name)),
      this.db.select().from(tours).orderBy(asc(tours.createdAt)),
      this.db.select().from(tourCities).orderBy(asc(tourCities.position)),
    ]);
    const countryById = new Map(rCountries.map((c) => [c.id, c]));
    const cityById = new Map(rCities.map((c) => [c.id, c]));
    const tcByTour = group(rTourCities, (tc) => tc.tourId);

    const indexed: TourIndexed[] = [];
    for (const t of rTours) {
      if (!t.isPublished) continue;
      const cityIds = (tcByTour.get(t.id) ?? []).map((tc) => tc.cityId).filter((id) => cityById.has(id));
      if (!cityIds.length) continue;
      const countryIds = [...new Set(cityIds.map((id) => cityById.get(id)!.countryId))];
      const regionIds = [...new Set(countryIds.map((id) => countryById.get(id)!.regionId))];
      indexed.push({ ...t, cityIds, cityId: cityIds[0], countryId: countryIds[0], regionId: regionIds[0], countryIds, regionIds });
    }

    const toursByCity = new Map<string, TourIndexed[]>();
    const toursByCountry = new Map<string, TourIndexed[]>();
    for (const t of indexed) {
      for (const c of t.cityIds) (toursByCity.get(c) ?? toursByCity.set(c, []).get(c)!).push(t);
      for (const c of t.countryIds) (toursByCountry.get(c) ?? toursByCountry.set(c, []).get(c)!).push(t);
    }

    this.snap = {
      loadedAt: Date.now(),
      regions: rRegions,
      regionById: new Map(rRegions.map((r) => [r.id, r])),
      countries: rCountries,
      countryById,
      cities: rCities,
      cityById,
      citiesByCountry: group(rCities, (c) => c.countryId),
      places: rPlaces,
      placeById: new Map(rPlaces.map((p) => [p.id, p])),
      placesByCity: group(rPlaces, (p) => p.cityId),
      stays: rStays,
      stayById: new Map(rStays.map((s) => [s.id, s])),
      staysByCity: group(rStays, (s) => s.cityId),
      tours: indexed,
      tourById: new Map(indexed.map((t) => [t.id, t])),
      toursByCity,
      toursByCountry,
    };
    return this.snap;
  }
}
