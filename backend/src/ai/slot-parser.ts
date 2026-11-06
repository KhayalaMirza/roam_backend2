import { CatalogSnapshot } from '../catalog/catalog.store';
import { Pricer } from '../common/money';
import type { Currency } from '../db/schema';
import { Slots } from './ai.types';

/**
 * Deterministic extraction of planner slots from free text, e.g.
 * "2 people, 5 days, around 1,500 AZN. Nature and city walks" → chips 2 people · 5 days · 1,500 AZN · Nature.
 * Used as the offline fallback and to pre-fill slots before the LLM call.
 */
const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (s: string) => NUM_WORDS[s.toLowerCase()] ?? Number(s.replace(/[,\s]/g, ''));

const TYPE_KEYWORDS: [string, RegExp][] = [
  ['sea', /\b(sea|beach|beaches|island|coast|diving|snorkel)/i],
  ['nature', /\b(nature|mountain|mountains|hiking|hike|forest|lake|national park|safari)/i],
  ['city_walks', /\b(city walks?|city break|walking|museums?|old town|architecture|history|culture)/i],
  ['adventure', /\b(adventure|rafting|trek|trekking|paraglid|climb|quad|ski)/i],
];

const DEPARTURE_NAMES: Record<string, string> = { baku: 'Baku', 'bakı': 'Baku', ganja: 'Ganja', 'gəncə': 'Ganja', sumqayit: 'Sumqayit', nakhchivan: 'Nakhchivan', 'naxçıvan': 'Nakhchivan', lankaran: 'Lankaran', istanbul: 'Istanbul', tbilisi: 'Tbilisi', moscow: 'Moscow' };
const KNOWN_DEPARTURES = Object.keys(DEPARTURE_NAMES);
const STOP_WORDS = new Set(['the', 'a', 'my', 'here', 'home', 'there', 'march', 'april', 'may', 'june', 'july', 'august']);

const CURRENCY_RE = '(azn|manat|₼|eur|euro|euros|€|usd|dollars?|\\$)';

function currencyOf(token: string | undefined, fallback: Currency): Currency {
  if (!token) return fallback;
  const t = token.toLowerCase();
  if (t === '€' || t.startsWith('eur')) return 'EUR';
  if (t === '$' || t.startsWith('usd') || t.startsWith('dollar')) return 'USD';
  return 'AZN';
}

export function parseSlots(text: string, s: CatalogSnapshot, pricer: Pricer): Partial<Slots> {
  const out: Partial<Slots> = {};
  const t = ` ${text.toLowerCase()} `;

  // Travelers
  const people = t.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(people|persons|person|adults|travel+ers|of us|pax|guests)\b/);
  const family = t.match(/family of (\d+|two|three|four|five|six)/);
  if (people) out.travelers = num(people[1]);
  else if (family) out.travelers = num(family[1]);
  else if (/\b(couple|honeymoon|with my (wife|husband|partner|girlfriend|boyfriend)|for two|two of us)\b/.test(t)) out.travelers = 2;
  else if (/\b(solo|alone|just me|myself|by myself)\b/.test(t)) out.travelers = 1;

  // Duration
  const days = t.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)[\s-]*(days?|nights?)\b/);
  const weeks = t.match(/\b(\d+|one|two|three)[\s-]*weeks?\b/);
  if (days) out.durationDays = num(days[1]) + (days[2].startsWith('night') ? 1 : 0);
  else if (weeks) out.durationDays = num(weeks[1]) * 7;
  else if (/\bweekend\b/.test(t)) out.durationDays = 3;
  else if (/\bweek\b/.test(t)) out.durationDays = 7;

  // Budget (total). "around 1,500 AZN", "under 800 AZN", "€1200", "$2,000"
  const b1 = t.match(new RegExp(`${CURRENCY_RE}\\s?(\\d[\\d,. ]*\\d|\\d)\\b`));
  const b2 = t.match(new RegExp(`\\b(\\d[\\d,]*(?:\\.\\d+)?)\\s?(k)?\\s?${CURRENCY_RE}`));
  const b3 = t.match(/\b(?:budget|under|below|up to|max(?:imum)?|around|about)\s+(?:of\s+)?(\d[\d,]*)(k)?\b/);
  let amount: number | null = null;
  let cur: Currency = pricer.currency;
  if (b2) {
    amount = Number(b2[1].replace(/,/g, '')) * (b2[2] ? 1000 : 1);
    cur = currencyOf(b2[3], pricer.currency);
  } else if (b1) {
    amount = Number(b1[2].replace(/[, ]/g, ''));
    cur = currencyOf(b1[1], pricer.currency);
  } else if (b3) {
    amount = Number(b3[1].replace(/,/g, '')) * (b3[2] ? 1000 : 1);
  }
  if (amount && amount >= 50) {
    const perPerson = /\b(per person|each|pp|a person)\b/.test(t);
    const azn = pricer.with(cur).toAZN(amount);
    out.budgetAZN = perPerson && out.travelers ? azn * out.travelers : azn;
  }

  // Travel types
  const types = TYPE_KEYWORDS.filter(([, re]) => re.test(t)).map(([id]) => id);
  if (types.length) out.travelTypes = types;

  // Destination: city > country > region names from the catalog
  // Ignore the departure phrase ("from Istanbul") when looking for the destination.
  const td = t.replace(/\b(from|leaving|departing)\s+[\p{L}-]+/gu, ' ');
  const hit =
    s.cities.find((c) => td.includes(c.name.toLowerCase())) ??
    s.countries.find((c) => td.includes(c.name.toLowerCase())) ??
    s.regions.find((r) => td.includes(r.name.toLowerCase()));
  if (hit) out.destination = hit.name;
  else if (/\bbeach somewhere|somewhere warm|anywhere|surprise me\b/.test(t)) out.destination = null;

  // Departure city
  const trimmed = text.trim().replace(/[.!]$/, '').toLowerCase();
  const known = KNOWN_DEPARTURES.find(
    (c) => trimmed === c || new RegExp(`(?<![\\p{L}])(from|leaving|departing)\\s+${c}(?![\\p{L}])`, 'iu').test(text),
  );
  const from = text.match(/\b[Ff]rom\s+([A-Z][a-zA-Zəöüğışç]+)/);
  if (known) out.departureCity = DEPARTURE_NAMES[known];
  else if (from && !STOP_WORDS.has(from[1].toLowerCase())) out.departureCity = from[1];

  // Flights
  if (/\b(flights? (are )?not included|without flights?|not included|exclude flights?|no flights?)\b/.test(t)) out.flightsIncluded = false;
  else if (/\b(flights? (are )?included|including flights?|with flights?|include flights?)\b/.test(t) || /^\s*(yes,?\s*)?included\.?\s*$/i.test(text))
    out.flightsIncluded = true;

  // Dates
  const range = t.match(/\b(\d{1,2})\s*[–-]\s*(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/);
  const iso = t.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|–|-)\s*(\d{4}-\d{2}-\d{2})/);
  if (iso) out.dates = { flexible: false, start: iso[1], end: iso[2] };
  else if (range) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const m = months.indexOf(range[3]);
    const now = new Date();
    const year = m < now.getMonth() ? now.getFullYear() + 1 : now.getFullYear();
    const pad = (n: number) => String(n).padStart(2, '0');
    out.dates = { flexible: false, start: `${year}-${pad(m + 1)}-${pad(Number(range[1]))}`, end: `${year}-${pad(m + 1)}-${pad(Number(range[2]))}` };
  } else if (/\bflexible|any time|anytime|not sure when\b/.test(t)) out.dates = { flexible: true, start: null, end: null };

  return out;
}

export function mergeSlots(base: Slots, patch: Partial<Slots>): Slots {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch) as [keyof Slots, unknown][]) {
    if (v === undefined) continue;
    if (k === 'travelTypes') {
      if (Array.isArray(v) && v.length) out.travelTypes = [...new Set(v as string[])];
      continue;
    }
    if (v !== null) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
