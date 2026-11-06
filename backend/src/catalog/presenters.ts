import { TRAVEL_TYPES } from '../common/constants';
import { City, Country, Place, Stay } from '../db/schema';
import { CatalogSnapshot, TourIndexed } from './catalog.store';
import { ViewContext } from './view-context';

const typeLabel = (id: string) => TRAVEL_TYPES.find((t) => t.id === id)?.label ?? id;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export const durationLabel = (days: number, nights: number) => `${plural(days, 'day')} / ${plural(nights, 'night')}`;

export function ref(o: { id: string; name: string } | undefined | null) {
  return o ? { id: o.id, name: o.name } : null;
}

export function presentTourCard(t: TourIndexed, s: CatalogSnapshot, ctx: ViewContext) {
  const city = s.cityById.get(t.cityId)!;
  const country = s.countryById.get(t.countryId)!;
  const region = s.regionById.get(t.regionId)!;
  return {
    id: t.id,
    title: t.title,
    summary: t.summary,
    region: ref(region),
    country: ref(country),
    city: ref(city),
    /** "Egypt · Cairo" */
    locationLabel: `${country.name} · ${city.name}`,
    days: t.days,
    nights: t.nights,
    durationLabel: durationLabel(t.days, t.nights),
    priceAZN: t.priceAZN,
    price: ctx.pricer.of(t.priceAZN),
    /** "From 980 AZN / person" */
    priceLabel: `From ${ctx.pricer.of(t.priceAZN).formatted} / person`,
    travelTypes: t.travelTypes.map((id) => ({ id, label: typeLabel(id) })),
    tags: t.tags,
    coverImageUrl: t.images[0] ?? null,
    isFavorite: ctx.isFavorite('tour', t.id),
  };
}

export function presentPlace(p: Place, s: CatalogSnapshot, ctx: ViewContext) {
  const city = s.cityById.get(p.cityId);
  const country = city ? s.countryById.get(city.countryId) : undefined;
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    description: p.description,
    durationHours: p.durationHours,
    priceAZN: p.priceAZN,
    price: p.priceAZN > 0 ? ctx.pricer.of(p.priceAZN) : null,
    /** "+25 AZN" or "Free" */
    priceLabel: p.priceAZN > 0 ? `+${ctx.pricer.of(p.priceAZN).formatted}` : 'Free',
    city: ref(city),
    country: ref(country),
    imageUrl: p.imageUrl,
    coordinate: p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null,
    isFavorite: ctx.isFavorite('place', p.id),
  };
}

export function presentStay(st: Stay, ctx: ViewContext) {
  return {
    id: st.id,
    name: st.name,
    kind: st.kind,
    stars: st.stars,
    description: st.description,
    pricePerNight: st.pricePerNightAZN != null ? ctx.pricer.of(st.pricePerNightAZN) : null,
    pricePerNightAZN: st.pricePerNightAZN,
    websiteUrl: st.websiteUrl,
    imageUrl: st.imageUrl,
    coordinate: st.lat != null && st.lng != null ? { lat: st.lat, lng: st.lng } : null,
  };
}

export function presentCountryCard(c: Country, s: CatalogSnapshot) {
  const cityCount = s.citiesByCountry.get(c.id)?.length ?? 0;
  return {
    id: c.id,
    name: c.name,
    region: ref(s.regionById.get(c.regionId)),
    imageUrl: c.imageUrl,
    cityCount,
    /** "Egypt · 6 cities" */
    subtitle: cityCount === 1 ? '1 city' : `${cityCount} cities`,
    tourCount: s.toursByCountry.get(c.id)?.length ?? 0,
  };
}

export function presentCityCard(c: City, s: CatalogSnapshot, ctx: ViewContext) {
  return {
    id: c.id,
    name: c.name,
    shortDescription: c.shortDescription,
    imageUrl: c.imageUrl,
    recommendedDays: c.recommendedDays,
    dailyBudget: ctx.pricer.of(c.dailyBudgetAZN),
    dailyBudgetAZN: c.dailyBudgetAZN,
    tourCount: s.toursByCity.get(c.id)?.length ?? 0,
  };
}

export function presentCountryDetail(c: Country, s: CatalogSnapshot, ctx: ViewContext) {
  return {
    ...presentCountryCard(c, s),
    description: c.description,
    info: [
      { title: 'Currency', value: c.currency },
      { title: 'Language', value: c.language },
      { title: 'Best season', value: c.bestSeason },
    ],
    currency: c.currency,
    language: c.language,
    bestSeason: c.bestSeason,
    cities: (s.citiesByCountry.get(c.id) ?? []).map((city) => presentCityCard(city, s, ctx)),
  };
}

export function presentCityDetail(c: City, s: CatalogSnapshot, ctx: ViewContext) {
  const country = s.countryById.get(c.countryId)!;
  const b = c.dailyBudgetBreakdown;
  return {
    ...presentCityCard(c, s, ctx),
    description: c.description,
    country: ref(country),
    region: ref(s.regionById.get(country.regionId)),
    recommendedStayLabel: plural(c.recommendedDays, 'day'),
    dailyBudget: ctx.pricer.of(c.dailyBudgetAZN),
    /** "~85 AZN / person" */
    dailyBudgetLabel: `~${ctx.pricer.of(c.dailyBudgetAZN).formatted} / person`,
    dailyBudgetNote: 'Includes stay, food, local transport and activities. Flights not included.',
    dailyBudgetBreakdown: {
      stay: ctx.pricer.of(b.stay),
      food: ctx.pricer.of(b.food),
      transport: ctx.pricer.of(b.transport),
      activities: ctx.pricer.of(b.activities),
    },
    transport: c.transport,
    coordinate: c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : null,
    places: (s.placesByCity.get(c.id) ?? []).map((p) => presentPlace(p, s, ctx)),
    stays: (s.staysByCity.get(c.id) ?? []).map((st) => presentStay(st, ctx)),
  };
}

export function presentTourDetail(t: TourIndexed, s: CatalogSnapshot, ctx: ViewContext) {
  const card = presentTourCard(t, s, ctx);
  const childPrice = t.childPriceAZN ?? t.priceAZN;
  const optionalExtras: { name: string; day: number; price: ReturnType<typeof ctx.pricer.of>; priceAZN: number }[] = [];

  const itinerary = t.itinerary.map((d) => {
    const city = s.cityById.get(d.cityId);
    return {
      day: d.day,
      title: d.title,
      description: d.description ?? '',
      city: ref(city),
      items: d.items.map((it) => {
        const place = it.placeId ? s.placeById.get(it.placeId) : undefined;
        const extra = it.extraPriceAZN ?? 0;
        if (!it.included && extra > 0) optionalExtras.push({ name: it.name, day: d.day, price: ctx.pricer.of(extra), priceAZN: extra });
        return {
          placeId: place?.id ?? null,
          name: it.name,
          category: place?.category ?? null,
          durationHours: it.durationHours ?? place?.durationHours ?? null,
          included: it.included,
          optional: Boolean(it.optional),
          extraPriceAZN: it.included ? null : extra,
          /** "included" | "+35 AZN" */
          priceLabel: it.included ? 'Included' : extra > 0 ? `+${ctx.pricer.of(extra).formatted}` : 'Free',
          coordinate: place?.lat != null && place?.lng != null ? { lat: place.lat, lng: place.lng } : null,
        };
      }),
    };
  });

  const tourStays = t.stays
    .map((ts) => {
      const st = s.stayById.get(ts.stayId);
      return st ? { ...presentStay(st, ctx), nights: ts.nights, city: ref(s.cityById.get(st.cityId)) } : null;
    })
    .filter(Boolean);

  const mapPoints = [
    ...itinerary.flatMap((d) => d.items.filter((i) => i.coordinate).map((i) => ({ kind: 'place' as const, id: i.placeId, name: i.name, day: d.day, ...i.coordinate! }))),
    ...tourStays.flatMap((st) => (st!.coordinate ? [{ kind: 'stay' as const, id: st!.id, name: st!.name, day: null, ...st!.coordinate }] : [])),
  ];

  return {
    ...card,
    description: t.description,
    /** Africa · Egypt · Cairo */
    breadcrumb: [card.region, card.country, card.city],
    cities: t.cityIds.map((id) => ref(s.cityById.get(id))),
    images: t.images,
    operatorName: t.operatorName,
    itinerary,
    stays: tourStays,
    budget: {
      packagePrice: ctx.pricer.of(t.priceAZN),
      packagePriceAZN: t.priceAZN,
      childPrice: ctx.pricer.of(childPrice),
      childPriceAZN: childPrice,
      perLabel: 'per person',
      optionalExtras,
    },
    included: t.included,
    excluded: t.excluded,
    map: { points: mapPoints },
  };
}
