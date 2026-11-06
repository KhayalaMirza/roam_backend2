import type { PlanSlots } from '../db/schema';

export type Slots = Required<Pick<PlanSlots, 'travelTypes'>> & Omit<PlanSlots, 'travelTypes'>;

export const REQUIRED_SLOTS = ['travelers', 'durationDays', 'budgetAZN', 'departureCity', 'flightsIncluded'] as const;
export type RequiredSlot = (typeof REQUIRED_SLOTS)[number];

export const emptySlots = (): Slots => ({
  destination: null,
  travelers: null,
  durationDays: null,
  budgetAZN: null,
  travelTypes: [],
  departureCity: null,
  dates: null,
  flightsIncluded: null,
});

/** Compact, catalog-referencing plan the LLM (or heuristic planner) proposes. The server prices it. */
export type PlanDraft = {
  title: string;
  summary: string;
  days: { day: number; cityId: string; title: string; placeIds: string[]; notes?: string | null }[];
  relatedTourIds?: string[];
};

export function missingSlots(s: Slots): RequiredSlot[] {
  return REQUIRED_SLOTS.filter((k) => s[k] === null || s[k] === undefined);
}
