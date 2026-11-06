import { Injectable, NotFoundException } from '@nestjs/common';
import { DURATION_FILTERS, SORT_OPTIONS, TRAVEL_TYPES } from '../common/constants';
import { CatalogSnapshot, CatalogStore, TourIndexed } from './catalog.store';
import { ToursQuery } from './catalog.dto';
import {
  presentCityDetail,
  presentCountryCard,
  presentCountryDetail,
  presentPlace,
  presentTourCard,
  presentTourDetail,
} from './presenters';
import { ViewContext } from './view-context';

const isAll = (v?: string | null) => !v || v.toLowerCase() === 'all';
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

@Injectable()
export class CatalogService {
  constructor(private readonly store: CatalogStore) {}

  async regions() {
    const s = await this.store.get();
    return [{ id: 'all', name: 'All' }, ...s.regions.map((r) => ({ id: r.id, name: r.name }))];
  }

  async countries(regionId: string | undefined) {
    const s = await this.store.get();
    return s.countries.filter((c) => isAll(regionId) || c.regionId === regionId).map((c) => presentCountryCard(c, s));
  }

  async country(id: string, ctx: ViewContext) {
    const s = await this.store.get();
    const c = s.countryById.get(id);
    if (!c) throw new NotFoundException('Country not found');
    return presentCountryDetail(c, s, ctx);
  }

  async city(id: string, ctx: ViewContext) {
    const s = await this.store.get();
    const c = s.cityById.get(id);
    if (!c) throw new NotFoundException('City not found');
    return presentCityDetail(c, s, ctx);
  }

  async place(id: string, ctx: ViewContext) {
    const s = await this.store.get();
    const p = s.placeById.get(id);
    if (!p) throw new NotFoundException('Place not found');
    return presentPlace(p, s, ctx);
  }

  filterTours(s: CatalogSnapshot, q: ToursQuery, toAZN: (n: number) => number): TourIndexed[] {
    const dur = DURATION_FILTERS.find((d) => d.id === (q.duration ?? 'any'))!;
    const minAZN = q.budgetMin != null ? toAZN(q.budgetMin) : null;
    const maxAZN = q.budgetMax != null ? toAZN(q.budgetMax) : null;
    const text = q.q ? norm(q.q.trim()) : null;

    let list = s.tours.filter((t) => {
      if (!isAll(q.region) && !t.regionIds.includes(q.region!)) return false;
      if (q.country?.length && !t.countryIds.some((c) => q.country!.includes(c))) return false;
      if (q.city && !t.cityIds.includes(q.city)) return false;
      if (minAZN != null && t.priceAZN < minAZN) return false;
      if (maxAZN != null && t.priceAZN > maxAZN) return false;
      if (dur.min != null && t.days < dur.min) return false;
      if (dur.max != null && t.days > dur.max) return false;
      if (q.type?.length && !t.travelTypes.some((tt) => q.type!.includes(tt))) return false;
      if (text) {
        const hay = norm(
          [t.title, t.summary, ...t.tags, ...t.cityIds.map((c) => s.cityById.get(c)?.name ?? ''), ...t.countryIds.map((c) => s.countryById.get(c)?.name ?? '')].join(' '),
        );
        if (!hay.includes(text)) return false;
      }
      return true;
    });

    if (q.sort === 'price_asc') list = [...list].sort((a, b) => a.priceAZN - b.priceAZN || a.days - b.days);
    else if (q.sort === 'duration') list = [...list].sort((a, b) => a.days - b.days || a.priceAZN - b.priceAZN);
    return list;
  }

  activeFilterCount(q: ToursQuery) {
    let n = 0;
    if (!isAll(q.region)) n++;
    if (q.country?.length) n++;
    if (q.budgetMin != null || q.budgetMax != null) n++;
    if (q.duration && q.duration !== 'any') n++;
    if (q.type?.length) n++;
    return n;
  }

  async tours(q: ToursQuery, ctx: ViewContext) {
    const s = await this.store.get();
    const all = this.filterTours(s, q, (n) => ctx.pricer.toAZN(n));
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const items = all.slice((page - 1) * limit, page * limit).map((t) => presentTourCard(t, s, ctx));
    return {
      items,
      page,
      limit,
      total: all.length,
      hasMore: page * limit < all.length,
      currency: ctx.pricer.currency,
      activeFilterCount: this.activeFilterCount(q),
      emptyState: all.length ? null : { title: 'No tours match your filters', action: 'Reset filters' },
    };
  }

  async tour(id: string, ctx: ViewContext) {
    const s = await this.store.get();
    const t = s.tourById.get(id);
    if (!t) throw new NotFoundException('Tour not found');
    return presentTourDetail(t, s, ctx);
  }

  /** Everything the Filter bottom sheet needs; countries follow the selected region. */
  async filterOptions(region: string | undefined, ctx: ViewContext) {
    const s = await this.store.get();
    const prices = s.tours.map((t) => t.priceAZN);
    const minAZN = prices.length ? Math.min(...prices) : 0;
    const maxAZN = prices.length ? Math.max(...prices) : 0;
    const roundDown = (n: number) => Math.floor(n / 50) * 50;
    const roundUp = (n: number) => Math.ceil(n / 50) * 50;
    return {
      regions: await this.regions(),
      countries: s.countries
        .filter((c) => isAll(region) || c.regionId === region)
        .filter((c) => (s.toursByCountry.get(c.id)?.length ?? 0) > 0)
        .map((c) => ({ id: c.id, name: c.name, regionId: c.regionId })),
      budget: {
        currency: ctx.pricer.currency,
        min: roundDown(ctx.pricer.of(minAZN).amount),
        max: roundUp(ctx.pricer.of(maxAZN).amount),
        step: ctx.pricer.currency === 'AZN' ? 50 : 25,
        minAZN,
        maxAZN,
      },
      durations: DURATION_FILTERS.map((d) => ({ id: d.id, label: d.label })),
      travelTypes: TRAVEL_TYPES.map((t) => ({ id: t.id, label: t.label })),
      sortOptions: SORT_OPTIONS.map((o) => ({ id: o.id, label: o.label })),
    };
  }
}
