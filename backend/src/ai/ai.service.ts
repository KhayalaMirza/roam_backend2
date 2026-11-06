import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { CatalogSnapshot, CatalogStore } from '../catalog/catalog.store';
import { ViewContext, ViewContextService } from '../catalog/view-context';
import { AuthUser } from '../common/auth';
import { TRAVEL_TYPE_IDS, TRAVEL_TYPES } from '../common/constants';
import { APP_CONFIG, AppConfig } from '../config/env';
import { DB, Db } from '../db/db.module';
import { aiPlans, aiUsage, Currency, users } from '../db/schema';
import { emptySlots, missingSlots, PlanDraft, RequiredSlot, Slots } from './ai.types';
import { LlmService } from './llm.service';
import { heuristicDraft, presentPlan, priceDraft, PricedPlan } from './planner';
import { mergeSlots, parseSlots } from './slot-parser';

export type ChatInput = {
  messages: { role: 'user' | 'assistant'; content: string }[];
  slots?: Record<string, unknown> | null;
  draft?: Record<string, unknown> | null;
  action?: 'message' | 'create_plan';
  currency?: Currency;
};

const EXAMPLES = ['Weekend city break under 800 AZN', 'Beach week for a family of 4', '2 people, 5 days, around 1,500 AZN. Nature and city walks'];

/** Sanitises client-echoed slots (never trust shape). */
export function sanitizeSlots(raw: unknown): Slots {
  const s = emptySlots();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  const int = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : null);
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null);
  s.destination = str(r.destination);
  s.travelers = int(r.travelers, 1, 20);
  s.durationDays = int(r.durationDays, 1, 30);
  s.budgetAZN = int(r.budgetAZN, 50, 1_000_000);
  s.travelTypes = Array.isArray(r.travelTypes) ? (r.travelTypes as unknown[]).filter((t): t is string => typeof t === 'string' && TRAVEL_TYPE_IDS.includes(t)) : [];
  s.departureCity = str(r.departureCity);
  s.flightsIncluded = typeof r.flightsIncluded === 'boolean' ? r.flightsIncluded : null;
  if (r.dates && typeof r.dates === 'object') {
    const d = r.dates as Record<string, unknown>;
    const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    s.dates = { flexible: Boolean(d.flexible), start: date(d.start), end: date(d.end) };
  }
  return s;
}

export function sanitizeDraft(raw: unknown): PlanDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.days)) return null;
  const days = (r.days as unknown[])
    .slice(0, 30)
    .filter((d): d is Record<string, unknown> => Boolean(d) && typeof d === 'object')
    .map((d, i) => ({
      day: typeof d.day === 'number' ? d.day : i + 1,
      cityId: String(d.cityId ?? ''),
      title: typeof d.title === 'string' ? d.title.slice(0, 120) : '',
      placeIds: Array.isArray(d.placeIds) ? (d.placeIds as unknown[]).filter((p): p is string => typeof p === 'string').slice(0, 6) : [],
      notes: typeof d.notes === 'string' ? d.notes.slice(0, 300) : null,
    }));
  return {
    title: typeof r.title === 'string' ? r.title.slice(0, 120) : '',
    summary: typeof r.summary === 'string' ? r.summary.slice(0, 500) : '',
    days,
    relatedTourIds: Array.isArray(r.relatedTourIds) ? (r.relatedTourIds as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 5) : [],
  };
}

@Injectable()
export class AiService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly store: CatalogStore,
    private readonly view: ViewContextService,
    private readonly llm: LlmService,
  ) {}

  /** Daily usage cap — guests by IP, users by id (PDF §11 open question; configurable). */
  private async consume(user: AuthUser | null, ip: string) {
    const key = user ? `user:${user.id}` : `ip:${ip}`;
    const limit = user ? this.cfg.ai.userDailyLimit : this.cfg.ai.guestDailyLimit;
    const day = new Date().toISOString().slice(0, 10);
    const [row] = await this.db
      .insert(aiUsage)
      .values({ key, day, count: 1 })
      .onConflictDoUpdate({ target: [aiUsage.key, aiUsage.day], set: { count: sql`${aiUsage.count} + 1` } })
      .returning({ count: aiUsage.count });
    if (row.count > limit) {
      throw new HttpException(
        {
          statusCode: 429,
          error: user ? 'AiDailyLimit' : 'AiGuestLimit',
          message: user ? 'You have reached today’s AI planner limit. Try again tomorrow.' : 'Log in to keep planning with AI.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return limit - row.count;
  }

  private async profileDefaults(user: AuthUser | null, slots: Slots, s: CatalogSnapshot): Promise<Slots> {
    if (!user) return slots;
    const [u] = await this.db.select({ preferences: users.preferences }).from(users).where(eq(users.id, user.id));
    const p = u?.preferences;
    if (!p) return slots;
    const out = { ...slots };
    if (!out.travelTypes.length && p.travelTypes.length) out.travelTypes = [...p.travelTypes];
    if (!out.destination && p.regions.length === 1) out.destination = s.regionById.get(p.regions[0])?.name ?? null;
    return out;
  }

  slotChips(sl: Slots, ctx: ViewContext) {
    const chips: { key: string; label: string }[] = [];
    if (sl.travelers) chips.push({ key: 'travelers', label: sl.travelers === 1 ? '1 person' : `${sl.travelers} people` });
    if (sl.durationDays) chips.push({ key: 'durationDays', label: `${sl.durationDays} day${sl.durationDays === 1 ? '' : 's'}` });
    if (sl.budgetAZN) chips.push({ key: 'budgetAZN', label: ctx.pricer.of(sl.budgetAZN).formatted });
    for (const t of sl.travelTypes) chips.push({ key: 'travelTypes', label: TRAVEL_TYPES.find((x) => x.id === t)?.label ?? t });
    if (sl.destination) chips.push({ key: 'destination', label: sl.destination });
    if (sl.departureCity) chips.push({ key: 'departureCity', label: `From ${sl.departureCity}` });
    if (sl.dates) chips.push({ key: 'dates', label: sl.dates.flexible || !sl.dates.start ? 'Flexible dates' : `${sl.dates.start} – ${sl.dates.end ?? ''}` });
    if (sl.flightsIncluded !== null && sl.flightsIncluded !== undefined)
      chips.push({ key: 'flightsIncluded', label: sl.flightsIncluded ? 'Flights included' : 'Flights not included' });
    return chips;
  }

  private question(missing: RequiredSlot[], sl: Slots, ctx: ViewContext): { reply: string; quickReplies: string[] } {
    const first = missing[0];
    const f = (azn: number) => ctx.pricer.of(azn).formatted;
    if (first === 'travelers' || first === 'durationDays' || first === 'budgetAZN') {
      const parts: string[] = [];
      const chips: string[] = [];
      for (const k of missing.filter((m) => ['travelers', 'durationDays', 'budgetAZN'].includes(m)).slice(0, 2)) {
        if (k === 'travelers') {
          parts.push('how many people are going');
          chips.push('Just me', '2 people', 'Family of 4');
        } else if (k === 'durationDays') {
          parts.push('how many days');
          chips.push('3 days', '5 days', '7 days');
        } else {
          parts.push('your total budget');
          chips.push(`Under ${f(800)}`, f(1500), f(3000));
        }
      }
      const reply = `Sounds great! Tell me ${parts.join(' and ')}.`;
      return { reply, quickReplies: chips.slice(0, 4) };
    }
    if (first === 'departureCity') {
      return {
        reply: sl.dates ? 'Where will you depart from?' : 'Where will you depart from, and when do you want to travel?',
        quickReplies: sl.dates ? ['Baku', 'Ganja'] : ['Baku', 'Ganja', 'Flexible dates'],
      };
    }
    return { reply: 'Are flights part of the budget?', quickReplies: ['Included', 'Not included'] };
  }

  async chat(input: ChatInput, user: AuthUser | null, ip: string) {
    const remaining = await this.consume(user, ip);
    const s = await this.store.get();
    const ctx = await this.view.build(user, input.currency);
    const draft = sanitizeDraft(input.draft);
    const forcePlan = input.action === 'create_plan';

    // 1) Slots: client echo (or re-parse history) + profile defaults + latest message.
    let slots = sanitizeSlots(input.slots);
    const userMsgs = input.messages.filter((m) => m.role === 'user');
    const toParse = input.slots ? userMsgs.slice(-1) : userMsgs;
    for (const m of toParse) slots = mergeSlots(slots, parseSlots(m.content, s, ctx.pricer));
    slots = await this.profileDefaults(user, slots, s);

    const last = userMsgs[userMsgs.length - 1]?.content.toLowerCase() ?? '';
    const refine = draft
      ? {
          cheaper: /\bcheaper|less expensive|lower (the )?budget|save money|budget-friendly\b/.test(last),
          addDay: /\b(add|one more|extra|another) (a )?day\b/.test(last),
          removeDay: /\b(remove|one less|fewer|drop) (a )?day|shorter\b/.test(last),
        }
      : { cheaper: false, addDay: false, removeDay: false };
    const isRefinement = refine.cheaper || refine.addDay || refine.removeDay;
    const currentPriced = draft ? priceDraft(draft, slots, s) : null;
    if (draft && currentPriced) {
      if (!slots.destination) slots.destination = s.countryById.get(s.cityById.get(currentPriced.cityIds[0])!.countryId)?.name ?? null;
      if (refine.addDay) slots.durationDays = (slots.durationDays ?? currentPriced.days) + 1;
      if (refine.removeDay) slots.durationDays = Math.max(1, (slots.durationDays ?? currentPriced.days) - 1);
      if (refine.cheaper) slots.budgetAZN = Math.round(currentPriced.budgetAZN.total * 0.8);
    }

    // 2) LLM turn (if configured); deterministic fallback otherwise.
    let reply = '';
    let quickReplies: string[] = [];
    let plan: PricedPlan | null = null;
    const llm = await this.llm.turn({ snapshot: s, slots, pricer: ctx.pricer, messages: input.messages, currentPlan: draft, forcePlan });
    if (llm) {
      slots = mergeSlots(slots, sanitizeSlots(llm.slots));
      reply = llm.reply;
      quickReplies = llm.quickReplies.slice(0, 4);
      if (missingSlots(slots).length === 0 && (llm.action === 'plan' || forcePlan)) {
        const d = llm.plan ? sanitizeDraft(llm.plan) : null;
        plan = (d && priceDraft(d, slots, s)) || null;
      }
    }

    const missing = missingSlots(slots);
    if (!plan && missing.length === 0 && (forcePlan || isRefinement || llm?.action === 'plan')) {
      const d = heuristicDraft(s, slots, { cheaper: refine.cheaper });
      plan = d ? priceDraft(d, slots, s) : null;
      if (!llm || llm.action !== 'plan') {
        reply = plan
          ? isRefinement
            ? 'Done — here is your updated plan.'
            : `Here’s a ${slots.durationDays}-day plan with an estimated budget.`
          : 'I couldn’t find a destination in our catalog that fits. Try a bigger budget or a different region.';
        quickReplies = plan ? ['Make it cheaper', 'Add one more day'] : ['Increase budget', 'Surprise me'];
      }
    }
    if (!llm && !plan) {
      if (missing.length) ({ reply, quickReplies } = this.question(missing, slots, ctx));
      else {
        reply = 'Great, I have everything I need. Tap “Create my plan” when you’re ready.';
        quickReplies = ['Create my plan'];
      }
    }
    if (plan && !quickReplies.length) quickReplies = ['Make it cheaper', 'Add one more day'];

    return {
      reply,
      quickReplies,
      slots,
      slotChips: this.slotChips(slots, ctx),
      missingSlots: missing,
      readyToPlan: missing.length === 0,
      plan: plan ? presentPlan(plan, s, ctx) : null,
      remainingToday: remaining,
      engine: llm ? 'llm' : 'rules',
    };
  }

  async discover(user: AuthUser | null) {
    return { title: 'AI TRIP PLANNER', prompt: 'Where do you want to go?', examples: EXAMPLES, plans: user ? await this.listPlans(user) : [] };
  }

  async savePlan(user: AuthUser, rawDraft: unknown, rawSlots: unknown, currency?: Currency) {
    const s = await this.store.get();
    const draft = sanitizeDraft(rawDraft);
    const slots = sanitizeSlots(rawSlots);
    if (!draft) throw new HttpException({ statusCode: 400, error: 'ValidationError', message: 'Plan is missing.' }, 400);
    const priced = priceDraft(draft, slots, s);
    if (!priced) throw new HttpException({ statusCode: 400, error: 'ValidationError', message: 'Plan does not reference known cities.' }, 400);
    const [row] = await this.db
      .insert(aiPlans)
      .values({
        userId: user.id,
        title: priced.title,
        summary: priced.summary,
        days: priced.days,
        travelers: priced.travelers,
        flightsIncluded: priced.flightsIncluded,
        departureCity: priced.departureCity,
        cityIds: priced.cityIds,
        budgetAZN: priced.budgetAZN,
        dayPlans: priced.dayPlans,
        relatedTourIds: priced.relatedTourIds,
        slots: priced.slots,
      })
      .returning();
    return presentPlan({ ...priced, id: row.id, createdAt: row.createdAt }, s, await this.view.build(user, currency));
  }

  async listPlans(user: AuthUser, currency?: Currency) {
    const s = await this.store.get();
    const ctx = await this.view.build(user, currency);
    const rows = await this.db.select().from(aiPlans).where(eq(aiPlans.userId, user.id)).orderBy(desc(aiPlans.createdAt));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      subtitle: `${r.days} day${r.days === 1 ? '' : 's'} · ${r.travelers === 1 ? '1 person' : `${r.travelers} people`}`,
      estimatedTotal: ctx.pricer.of(r.budgetAZN.total),
      cities: r.cityIds.map((id) => ({ id, name: s.cityById.get(id)?.name ?? id })),
      createdAt: r.createdAt,
    }));
  }

  async getPlan(user: AuthUser, id: string, currency?: Currency) {
    const [r] = await this.db.select().from(aiPlans).where(and(eq(aiPlans.id, id), eq(aiPlans.userId, user.id)));
    if (!r) throw new NotFoundException('Plan not found');
    const s = await this.store.get();
    const priced: PricedPlan = {
      title: r.title,
      summary: r.summary,
      days: r.days,
      travelers: r.travelers,
      flightsIncluded: r.flightsIncluded,
      departureCity: r.departureCity,
      cityIds: r.cityIds,
      budgetAZN: r.budgetAZN,
      dayPlans: r.dayPlans,
      relatedTourIds: r.relatedTourIds,
      slots: sanitizeSlots(r.slots),
    };
    return presentPlan({ ...priced, id: r.id, createdAt: r.createdAt }, s, await this.view.build(user, currency));
  }

  async deletePlan(user: AuthUser, id: string) {
    const res = await this.db.delete(aiPlans).where(and(eq(aiPlans.id, id), eq(aiPlans.userId, user.id))).returning({ id: aiPlans.id });
    if (!res.length) throw new NotFoundException('Plan not found');
  }
}
