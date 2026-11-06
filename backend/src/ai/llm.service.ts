import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CatalogSnapshot } from '../catalog/catalog.store';
import { TRAVEL_TYPE_IDS } from '../common/constants';
import { Pricer } from '../common/money';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PlanDraft, Slots } from './ai.types';

export type LlmTurn = {
  reply: string;
  quickReplies: string[];
  slots: Slots;
  action: 'ask' | 'ready' | 'plan';
  plan: PlanDraft | null;
};

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, 'null'], ...extra });

/** JSON schema for structured outputs — the UI renders this as chips and plan cards (PDF §6). */
const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'quickReplies', 'slots', 'action', 'plan'],
  properties: {
    reply: { type: 'string', description: 'Short message to the traveler, 1–2 questions max. English only.' },
    quickReplies: { type: 'array', items: { type: 'string' }, description: 'Up to 4 tappable answer chips for the question asked.' },
    action: { type: 'string', enum: ['ask', 'ready', 'plan'] },
    slots: {
      type: 'object',
      additionalProperties: false,
      required: ['destination', 'travelers', 'durationDays', 'budgetAZN', 'travelTypes', 'departureCity', 'dates', 'flightsIncluded'],
      properties: {
        destination: nullable('string'),
        travelers: nullable('integer'),
        durationDays: nullable('integer'),
        budgetAZN: nullable('integer', { description: 'TOTAL trip budget converted to AZN' }),
        travelTypes: { type: 'array', items: { type: 'string', enum: TRAVEL_TYPE_IDS } },
        departureCity: nullable('string'),
        dates: {
          anyOf: [
            { type: 'null' },
            {
              type: 'object',
              additionalProperties: false,
              required: ['flexible', 'start', 'end'],
              properties: { flexible: { type: 'boolean' }, start: nullable('string'), end: nullable('string') },
            },
          ],
        },
        flightsIncluded: nullable('boolean'),
      },
    },
    plan: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'summary', 'days', 'relatedTourIds'],
          properties: {
            title: { type: 'string', description: 'e.g. "Tbilisi & Kazbegi"' },
            summary: { type: 'string' },
            relatedTourIds: { type: 'array', items: { type: 'string' } },
            days: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['day', 'cityId', 'title', 'placeIds', 'notes'],
                properties: {
                  day: { type: 'integer' },
                  cityId: { type: 'string' },
                  title: { type: 'string' },
                  placeIds: { type: 'array', items: { type: 'string' } },
                  notes: nullable('string'),
                },
              },
            },
          },
        },
      ],
    },
  },
} as const;

function catalogContext(s: CatalogSnapshot, slots: Slots) {
  // Narrow the context when the destination is known to keep prompts small for big catalogs.
  const dest = slots.destination?.toLowerCase();
  const matchCountry = dest && s.countries.find((c) => c.name.toLowerCase() === dest || s.citiesByCountry.get(c.id)?.some((ci) => ci.name.toLowerCase() === dest));
  const matchRegion = dest && s.regions.find((r) => r.name.toLowerCase() === dest);
  const countries = s.countries.filter((c) => (matchCountry ? c.id === matchCountry.id : matchRegion ? c.regionId === matchRegion.id : true));
  const lines: string[] = ['COUNTRIES (id | name | region | round-trip flight from Baku per person AZN | best season)'];
  for (const c of countries) lines.push(`${c.id} | ${c.name} | ${c.regionId} | ${c.flightFromBakuAZN} | ${c.bestSeason}`);
  lines.push('', 'CITIES (id | name | countryId | recommended days | daily per person AZN: stay/food/transport/activities)');
  const cityList = countries.flatMap((c) => s.citiesByCountry.get(c.id) ?? []);
  for (const c of cityList) {
    const b = c.dailyBudgetBreakdown;
    lines.push(`${c.id} | ${c.name} | ${c.countryId} | ${c.recommendedDays} | ${b.stay}/${b.food}/${b.transport}/${b.activities} — ${c.shortDescription}`);
  }
  lines.push('', 'PLACES (id | cityId | name | category | hours | price AZN per person, 0 = free)');
  for (const c of cityList) for (const p of s.placesByCity.get(c.id) ?? []) lines.push(`${p.id} | ${p.cityId} | ${p.name} | ${p.category} | ${p.durationHours} | ${p.priceAZN}`);
  lines.push('', 'TOURS (id | title | cityIds | days | price per person AZN | travel types)');
  const countryIds = new Set(countries.map((c) => c.id));
  for (const t of s.tours.filter((t) => t.countryIds.some((c) => countryIds.has(c))))
    lines.push(`${t.id} | ${t.title} | ${t.cityIds.join(',')} | ${t.days} | ${t.priceAZN} | ${t.travelTypes.join(',')}`);
  return lines.join('\n');
}

function systemPrompt(s: CatalogSnapshot, slots: Slots, pricer: Pricer) {
  return `You are Roam's AI trip planner inside an iOS travel app for travelers from Azerbaijan. Always write in English.

GOAL: chat briefly with the traveler, collect the details below, then produce a day-by-day plan using ONLY the catalog data provided.

SLOTS
Required: travelers, durationDays, budgetAZN (TOTAL trip budget in AZN), departureCity, flightsIncluded.
Optional: destination (country, city or region — you may suggest one), travelTypes (${TRAVEL_TYPE_IDS.join(', ')}), dates (flexible or start/end).

RULES
- Ask at most 1–2 short questions per turn. Offer answer options in quickReplies (max 4, short, e.g. "Baku", "Flexible", "Included", "Not included").
- Recommended question order once the basics are known: departure city and travel dates together, then "Are flights part of the budget?".
- Never create a plan while a required slot is missing. When all required slots are filled but the user hasn't asked to create the plan, set action="ready" and tell them they can tap "Create my plan".
- When the user asks to create the plan (or to change an existing plan, e.g. "Make it cheaper", "Add one more day"), set action="plan" and return plan.
- Plan: one entry per day, each with a cityId and 1–3 placeIds from that same city. Use only ids from the catalog. Prefer cities whose daily budget × days × travelers (+ flights × travelers if flights are in the budget) + place prices fits budgetAZN. Title like "Tbilisi & Kazbegi".
- Do NOT state prices or totals in "reply" — the app computes the estimate from the catalog and shows it in ${pricer.currency}. Never promise availability; plans are estimates.
- Always return the full, updated slots object (keep values the user already gave). Budgets the user states in EUR/USD must be converted to AZN: 1 USD = ${pricer.rates.aznPerUsd} AZN, 1 EUR = ${pricer.rates.aznPerEur} AZN.
- relatedTourIds: up to 3 catalog tours that overlap with the plan's cities.
- Off-topic requests: politely steer back to trip planning.

CURRENT SLOTS (from earlier turns and the traveler's profile defaults):
${JSON.stringify(slots)}

CATALOG
${catalogContext(s, slots)}`;
}

@Injectable()
export class LlmService {
  private readonly log = new Logger(LlmService.name);
  private client: Anthropic | null = null;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    if (cfg.ai.anthropicApiKey) this.client = new Anthropic({ apiKey: cfg.ai.anthropicApiKey, maxRetries: 2, timeout: 60_000 });
  }

  get enabled() {
    return this.client !== null;
  }

  async turn(args: {
    snapshot: CatalogSnapshot;
    slots: Slots;
    pricer: Pricer;
    messages: { role: 'user' | 'assistant'; content: string }[];
    currentPlan: PlanDraft | null;
    forcePlan: boolean;
  }): Promise<LlmTurn | null> {
    if (!this.client) return null;
    const messages = args.messages.map((m) => ({ role: m.role, content: m.content }));
    const hints: string[] = [];
    if (args.currentPlan) hints.push(`CURRENT PLAN (modify it if the user asks for changes): ${JSON.stringify(args.currentPlan)}`);
    if (args.forcePlan) hints.push('The traveler tapped "Create my plan". If every required slot is filled, return action="plan" with a plan.');
    if (hints.length && messages.length && messages[messages.length - 1].role === 'user') {
      const last = messages[messages.length - 1];
      messages[messages.length - 1] = { role: 'user', content: `${last.content}\n\n[app context]\n${hints.join('\n')}` };
    } else if (hints.length) {
      messages.push({ role: 'user', content: `[app context]\n${hints.join('\n')}` });
    }
    try {
      const res = await this.client.messages.create({
        model: this.cfg.ai.model,
        max_tokens: 4000,
        system: systemPrompt(args.snapshot, args.slots, args.pricer),
        messages,
        output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA as unknown as Record<string, unknown> } },
      });
      const text = res.content.find((b) => b.type === 'text');
      if (!text || text.type !== 'text') return null;
      return JSON.parse(text.text) as LlmTurn;
    } catch (e) {
      this.log.error(`LLM call failed, falling back to rule-based planner: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }
}
