/** Fixed taxonomies used by filters, the AI planner and validation. */

export const TRAVEL_TYPES = [
  { id: 'sea', label: 'Sea' },
  { id: 'nature', label: 'Nature' },
  { id: 'city_walks', label: 'City walks' },
  { id: 'adventure', label: 'Adventure' },
] as const;
export type TravelType = (typeof TRAVEL_TYPES)[number]['id'];
export const TRAVEL_TYPE_IDS = TRAVEL_TYPES.map((t) => t.id) as string[];

export const DURATION_FILTERS = [
  { id: 'any', label: 'Any', min: null, max: null },
  { id: '1-3', label: '1–3 days', min: 1, max: 3 },
  { id: '4-7', label: '4–7 days', min: 4, max: 7 },
  { id: '8+', label: '8+ days', min: 8, max: null },
] as const;
export const DURATION_IDS = DURATION_FILTERS.map((d) => d.id) as string[];

export const SORT_OPTIONS = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'price_asc', label: 'Price: low to high' },
  { id: 'duration', label: 'Duration' },
] as const;
export const SORT_IDS = SORT_OPTIONS.map((s) => s.id) as string[];

export const PLACE_CATEGORIES = ['Sightseeing', 'Culture', 'Nature', 'Market', 'Food', 'Adventure', 'Beach'] as const;

export const CURRENCIES = ['AZN', 'EUR', 'USD'] as const;

export const REQUEST_STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting for operator',
  confirmed: 'Confirmed by operator',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const REQUEST_DISCLAIMER =
  'Requests are not bookings. A request is confirmed only when the tour operator contacts you.';

export const REQUEST_NEXT_STEPS = [
  { step: 1, title: 'Operator reviews your request', body: 'The tour operator checks availability for your dates and group.' },
  { step: 2, title: 'They contact you', body: 'You get a call or email to confirm the final price and dates.' },
  { step: 3, title: 'Confirm directly with the operator', body: 'Payment and booking happen outside the app. No payment in the app.' },
];

export const PLAN_ESTIMATE_NOTE = 'Prices are estimates and are not confirmed.';
