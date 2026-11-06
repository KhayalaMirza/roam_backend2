import { CatalogSnapshot, TourIndexed } from '../catalog/catalog.store';
import { presentTourCard, ref } from '../catalog/presenters';
import { ViewContext } from '../catalog/view-context';
import { PLAN_ESTIMATE_NOTE, TRAVEL_TYPES } from '../common/constants';
import { City, Place, PlanBudget, PlanDay } from '../db/schema';
import { PlanDraft, Slots } from './ai.types';

/** Category affinity per travel type — used to pick activities and rank cities. */
const TYPE_CATEGORIES: Record<string, string[]> = {
  sea: ['Beach', 'Nature'],
  nature: ['Nature', 'Adventure'],
  city_walks: ['Culture', 'Sightseeing', 'Market', 'Food'],
  adventure: ['Adventure', 'Nature'],
};

export type PricedPlan = {
  title: string;
  summary: string;
  days: number;
  travelers: number;
  flightsIncluded: boolean;
  departureCity: string | null;
  cityIds: string[];
  budgetAZN: PlanBudget;
  dayPlans: PlanDay[];
  relatedTourIds: string[];
  slots: Slots;
};

/**
 * Validates a draft against the catalog and prices it deterministically
 * (PDF §6: prices come from City “Daily budget” and Place prices — never from the model).
 */
export function priceDraft(draft: PlanDraft, slots: Slots, s: CatalogSnapshot): PricedPlan | null {
  const travelers = Math.max(1, slots.travelers ?? 1);
  const flightsIncluded = Boolean(slots.flightsIncluded);
  const days = draft.days
    .filter((d) => s.cityById.has(d.cityId))
    .sort((a, b) => a.day - b.day)
    .map((d, i) => ({ ...d, day: i + 1 }));
  if (!days.length) return null;

  const budget: PlanBudget = { stay: 0, food: 0, transport: 0, activities: 0, flights: 0, total: 0 };
  const dayPlans: PlanDay[] = days.map((d) => {
    const city = s.cityById.get(d.cityId)!;
    const b = city.dailyBudgetBreakdown;
    budget.stay += b.stay * travelers;
    budget.food += b.food * travelers;
    budget.transport += b.transport * travelers;
    const items = [...new Set(d.placeIds)]
      .map((id) => s.placeById.get(id))
      .filter((p): p is Place => Boolean(p) && p!.cityId === d.cityId)
      .slice(0, 4)
      .map((p) => {
        budget.activities += p.priceAZN * travelers;
        return { placeId: p.id, name: p.name, category: p.category, durationHours: p.durationHours, priceAZN: p.priceAZN };
      });
    return { day: d.day, cityId: d.cityId, title: d.title?.trim() || `Explore ${city.name}`, items, notes: d.notes ?? null };
  });

  const cityIds = [...new Set(dayPlans.map((d) => d.cityId))];
  if (flightsIncluded) {
    const country = s.countryById.get(s.cityById.get(cityIds[0])!.countryId)!;
    budget.flights = country.flightFromBakuAZN * travelers;
  }
  budget.total = budget.stay + budget.food + budget.transport + budget.activities + budget.flights;

  const related = relatedTours(s, cityIds, slots, draft.relatedTourIds ?? []);
  const fallbackTitle = cityIds.slice(0, 2).map((id) => s.cityById.get(id)!.name).join(' & ');
  return {
    title: draft.title?.trim() || fallbackTitle,
    summary: draft.summary?.trim() ?? '',
    days: dayPlans.length,
    travelers,
    flightsIncluded,
    departureCity: slots.departureCity ?? null,
    cityIds,
    budgetAZN: budget,
    dayPlans,
    relatedTourIds: related.map((t) => t.id),
    slots,
  };
}

export function relatedTours(s: CatalogSnapshot, cityIds: string[], slots: Slots, suggested: string[]): TourIndexed[] {
  const countryIds = new Set(cityIds.map((id) => s.cityById.get(id)?.countryId));
  const perPerson = slots.budgetAZN && slots.travelers ? slots.budgetAZN / slots.travelers : null;
  const scored = s.tours
    .map((t) => {
      let score = 0;
      const sameCountry = t.countryIds.some((c) => countryIds.has(c));
      if (!sameCountry && !suggested.includes(t.id)) return { t, score: 0 };
      if (suggested.includes(t.id)) score += 5;
      score += t.cityIds.filter((c) => cityIds.includes(c)).length * 3;
      if (sameCountry) score += 2;
      score += t.travelTypes.filter((tt) => slots.travelTypes.includes(tt)).length;
      if (perPerson && t.priceAZN <= perPerson * 1.15) score += 1;
      return { t, score };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score || a.t.priceAZN - b.t.priceAZN);
  return scored.slice(0, 3).map((x) => x.t);
}

function cityScore(c: City, s: CatalogSnapshot, slots: Slots) {
  const places = s.placesByCity.get(c.id) ?? [];
  const wanted = slots.travelTypes.flatMap((t) => TYPE_CATEGORIES[t] ?? []);
  const typeHits = places.filter((p) => wanted.includes(p.category)).length;
  const tourHits = (s.toursByCity.get(c.id) ?? []).filter((t) => t.travelTypes.some((tt) => slots.travelTypes.includes(tt))).length;
  return typeHits + tourHits * 2;
}

/** Rough per-trip cost of a country at its cheapest-city rates — used to keep suggestions within budget. */
function estimateCountryCost(countryId: string, s: CatalogSnapshot, slots: Slots) {
  const cs = s.citiesByCountry.get(countryId) ?? [];
  if (!cs.length) return Infinity;
  const daily = Math.min(...cs.map((c) => c.dailyBudgetAZN));
  const travelers = slots.travelers ?? 1;
  const flights = slots.flightsIncluded ? s.countryById.get(countryId)!.flightFromBakuAZN * travelers : 0;
  return daily * (slots.durationDays ?? 3) * travelers + flights;
}

/** Offline / fallback planner: picks a destination that fits the budget and travel style, then fills days with places. */
export function heuristicDraft(s: CatalogSnapshot, slots: Slots, opts: { cheaper?: boolean; preferRegions?: string[]; avoidCountryIds?: string[] } = {}): PlanDraft | null {
  const dest = slots.destination?.toLowerCase().trim();
  let candidateCities: City[] = s.cities;
  if (dest) {
    const city = s.cities.find((c) => c.name.toLowerCase() === dest || c.id === dest);
    const country = s.countries.find((c) => c.name.toLowerCase() === dest || c.id === dest);
    const region = s.regions.find((r) => r.name.toLowerCase() === dest || r.id === dest);
    if (city) candidateCities = s.citiesByCountry.get(city.countryId) ?? [city];
    else if (country) candidateCities = s.citiesByCountry.get(country.id) ?? [];
    else if (region) candidateCities = s.cities.filter((c) => s.countryById.get(c.countryId)?.regionId === region.id);
  }
  if (!candidateCities.length) candidateCities = s.cities;

  const budget = slots.budgetAZN ?? Infinity;
  const countryIds = [...new Set(candidateCities.map((c) => c.countryId))].filter((id) => !opts.avoidCountryIds?.includes(id));
  const ranked = countryIds
    .map((id) => {
      const cost = estimateCountryCost(id, s, slots);
      const style = (s.citiesByCountry.get(id) ?? []).reduce((a, c) => a + cityScore(c, s, slots), 0);
      const pref = opts.preferRegions?.includes(s.countryById.get(id)!.regionId) ? 2 : 0;
      const fits = cost <= budget;
      // Prefer destinations that fit; among them, ones that match the travel style and use the budget well.
      const usage = Number.isFinite(budget) ? cost / budget : 0.5;
      return { id, score: (fits ? 100 : 0) + style * 3 + pref + (fits ? usage * 10 : -cost / 100) };
    })
    .sort((a, b) => b.score - a.score);
  const countryId = ranked[0]?.id;
  if (!countryId) return null;

  const totalDays = Math.max(1, Math.min(slots.durationDays ?? 3, 21));
  const cities = [...(s.citiesByCountry.get(countryId) ?? [])]
    .filter((c) => candidateCities.some((cc) => cc.id === c.id) || !dest)
    .sort((a, b) => {
      const exact = (c: City) => (dest && c.name.toLowerCase() === dest ? 100 : 0);
      return exact(b) + cityScore(b, s, slots) - (exact(a) + cityScore(a, s, slots)) || (s.placesByCity.get(b.id)?.length ?? 0) - (s.placesByCity.get(a.id)?.length ?? 0);
    });
  if (!cities.length) return null;

  // Allocate days: each city gets up to its recommended stay; at most 3 cities.
  const stops: { city: City; days: number }[] = [];
  let left = totalDays;
  for (const c of cities.slice(0, 3)) {
    if (left <= 0) break;
    const d = stops.length === 0 ? Math.min(left, Math.max(c.recommendedDays, totalDays <= 4 ? totalDays : 2)) : Math.min(left, c.recommendedDays);
    stops.push({ city: c, days: d });
    left -= d;
  }
  if (left > 0) stops[0].days += left;

  const wanted = slots.travelTypes.flatMap((t) => TYPE_CATEGORIES[t] ?? []);
  const days: PlanDraft['days'] = [];
  let dayNo = 1;
  for (const stop of stops) {
    const pool = [...(s.placesByCity.get(stop.city.id) ?? [])].sort((a, b) => {
      const w = (p: Place) => (wanted.includes(p.category) ? -10 : 0) + (opts.cheaper ? p.priceAZN / 10 : 0);
      return w(a) - w(b);
    });
    for (let i = 0; i < stop.days; i++) {
      const picks = pool.splice(0, opts.cheaper ? 1 : 2);
      const first = picks[0]?.name;
      const title =
        dayNo === 1 ? `Arrival in ${stop.city.name}${first ? ` & ${first}` : ''}` : first ? `${first}${picks[1] ? ` & ${picks[1].name}` : ''}` : `Free day in ${stop.city.name}`;
      days.push({ day: dayNo++, cityId: stop.city.id, title, placeIds: picks.map((p) => p.id), notes: null });
    }
  }
  const names = stops.slice(0, 2).map((x) => x.city.name);
  const country = s.countryById.get(countryId)!;
  return {
    title: names.join(' & '),
    summary: `${totalDays} days in ${country.name}${slots.travelTypes.length ? ` focused on ${slots.travelTypes.map((t) => TRAVEL_TYPES.find((x) => x.id === t)?.label.toLowerCase() ?? t).join(' and ')}` : ''}.`,
    days,
  };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function presentPlan(p: PricedPlan & { id?: string | null; createdAt?: Date | null }, s: CatalogSnapshot, ctx: ViewContext) {
  const m = (azn: number) => ctx.pricer.of(azn);
  const b = p.budgetAZN;
  const budgetLimit = p.slots.budgetAZN ?? null;
  const breakdown = [
    { key: 'stay', label: 'Stay', amountAZN: b.stay, amount: m(b.stay) },
    { key: 'food', label: 'Food', amountAZN: b.food, amount: m(b.food) },
    { key: 'transport', label: 'Transport', amountAZN: b.transport, amount: m(b.transport) },
    { key: 'activities', label: 'Activities', amountAZN: b.activities, amount: m(b.activities) },
    ...(p.flightsIncluded ? [{ key: 'flights', label: 'Flights', amountAZN: b.flights, amount: m(b.flights) }] : []),
  ];
  return {
    id: p.id ?? null,
    saved: Boolean(p.id),
    title: p.title,
    summary: p.summary,
    label: 'Estimate',
    days: p.days,
    travelers: p.travelers,
    flightsIncluded: p.flightsIncluded,
    departureCity: p.departureCity,
    /** "5 days · 2 people · flights not included" */
    subtitle: `${plural(p.days, 'day')} · ${p.travelers === 1 ? '1 person' : `${p.travelers} people`} · flights ${p.flightsIncluded ? 'included' : 'not included'}`,
    currency: ctx.pricer.currency,
    estimatedTotal: m(b.total),
    estimatedTotalAZN: b.total,
    /** "~1,420 AZN" */
    estimatedTotalLabel: `~${m(b.total).formatted}`,
    userBudget: budgetLimit != null ? m(budgetLimit) : null,
    withinBudget: budgetLimit == null ? true : b.total <= budgetLimit * 1.05,
    breakdown,
    cities: p.cityIds.map((id) => ref(s.cityById.get(id))),
    dayPlans: p.dayPlans.map((d) => ({
      day: d.day,
      city: ref(s.cityById.get(d.cityId)),
      title: d.title,
      notes: d.notes ?? null,
      items: d.items.map((it) => ({
        placeId: it.placeId,
        name: it.name,
        category: it.category ?? null,
        durationHours: it.durationHours ?? null,
        priceAZN: it.priceAZN,
        price: it.priceAZN > 0 ? m(it.priceAZN) : null,
        priceLabel: it.priceAZN > 0 ? `+${m(it.priceAZN).formatted}` : 'Free',
        isFavorite: it.placeId ? ctx.isFavorite('place', it.placeId) : false,
      })),
    })),
    relatedTours: p.relatedTourIds.map((id) => s.tourById.get(id)).filter((t): t is TourIndexed => Boolean(t)).map((t) => presentTourCard(t, s, ctx)),
    note: PLAN_ESTIMATE_NOTE,
    /** Send back as `draft` to refine in chat or to POST /ai/plans. */
    draft: {
      title: p.title,
      summary: p.summary,
      days: p.dayPlans.map((d) => ({ day: d.day, cityId: d.cityId, title: d.title, placeIds: d.items.map((i) => i.placeId).filter(Boolean), notes: d.notes ?? null })),
      relatedTourIds: p.relatedTourIds,
    },
    slots: p.slots,
    createdAt: p.createdAt ?? null,
  };
}
