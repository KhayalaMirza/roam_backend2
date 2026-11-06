import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * All money is stored in AZN (integer manats). Display currencies are
 * derived from exchange_rates at response time (PDF §8).
 */

export const currencyEnum = pgEnum('currency', ['AZN', 'EUR', 'USD']);
export const userRoleEnum = pgEnum('user_role', ['user', 'operator', 'admin']);
export const favoriteTypeEnum = pgEnum('favorite_type', ['tour', 'place']);
export const requestStatusEnum = pgEnum('request_status', ['pending', 'confirmed', 'completed', 'cancelled']);

// ---------- Catalog (single source of truth) ----------

export const regions = pgTable('regions', {
  id: text('id').primaryKey(), // 'europe', 'asia', 'middle-east', 'africa'
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const countries = pgTable(
  'countries',
  {
    id: text('id').primaryKey(), // 'egypt'
    regionId: text('region_id')
      .notNull()
      .references(() => regions.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    currency: text('currency').notNull(), // 'Egyptian pound'
    language: text('language').notNull(),
    bestSeason: text('best_season').notNull(),
    imageUrl: text('image_url'),
    /** Round-trip economy estimate from Baku, per person — used by the AI planner when flights are in budget. */
    flightFromBakuAZN: integer('flight_from_baku_azn').notNull().default(0),
  },
  (t) => [index('countries_region_idx').on(t.regionId)],
);

export type DailyBudget = { stay: number; food: number; transport: number; activities: number };

export const cities = pgTable(
  'cities',
  {
    id: text('id').primaryKey(), // 'cairo'
    countryId: text('country_id')
      .notNull()
      .references(() => countries.id),
    name: text('name').notNull(),
    shortDescription: text('short_description').notNull().default(''),
    description: text('description').notNull().default(''),
    imageUrl: text('image_url'),
    recommendedDays: integer('recommended_days').notNull().default(2),
    /** Per person per day: stay + food + local transport + activities, flights excluded. */
    dailyBudgetAZN: integer('daily_budget_azn').notNull(),
    dailyBudgetBreakdown: jsonb('daily_budget_breakdown').$type<DailyBudget>().notNull(),
    transport: text('transport').array().notNull().default(sql`'{}'::text[]`),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
  },
  (t) => [index('cities_country_idx').on(t.countryId)],
);

export const places = pgTable(
  'places',
  {
    id: text('id').primaryKey(),
    cityId: text('city_id')
      .notNull()
      .references(() => cities.id),
    name: text('name').notNull(),
    category: text('category').notNull(), // Sightseeing | Culture | Nature | Market | ...
    description: text('description').notNull().default(''),
    durationHours: numeric('duration_hours', { mode: 'number' }).notNull(),
    priceAZN: integer('price_azn').notNull().default(0), // 0 = Free
    imageUrl: text('image_url'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
  },
  (t) => [index('places_city_idx').on(t.cityId)],
);

export const stays = pgTable(
  'stays',
  {
    id: text('id').primaryKey(),
    cityId: text('city_id')
      .notNull()
      .references(() => cities.id),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('Hotel'),
    stars: integer('stars'),
    description: text('description').notNull().default(''),
    pricePerNightAZN: integer('price_per_night_azn'),
    websiteUrl: text('website_url'),
    imageUrl: text('image_url'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
  },
  (t) => [index('stays_city_idx').on(t.cityId)],
);

export type ItineraryItem = {
  placeId?: string | null;
  name: string;
  durationHours?: number | null;
  /** true => covered by the package price */
  included: boolean;
  optional?: boolean;
  extraPriceAZN?: number | null;
};
export type ItineraryDay = { day: number; title: string; cityId: string; description?: string; items: ItineraryItem[] };
export type TourStay = { stayId: string; nights: number };

export const tours = pgTable('tours', {
  id: text('id').primaryKey(), // 'pyramids-nile-cruise'
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  description: text('description').notNull().default(''),
  days: integer('days').notNull(),
  nights: integer('nights').notNull(),
  priceAZN: integer('price_azn').notNull(),
  /** Per child (2–11). Null => same as adult price. */
  childPriceAZN: integer('child_price_azn'),
  travelTypes: text('travel_types').array().notNull().default(sql`'{}'::text[]`),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  itinerary: jsonb('itinerary').$type<ItineraryDay[]>().notNull().default([]),
  stays: jsonb('stays').$type<TourStay[]>().notNull().default([]),
  included: text('included').array().notNull().default(sql`'{}'::text[]`),
  excluded: text('excluded').array().notNull().default(sql`'{}'::text[]`),
  images: text('images').array().notNull().default(sql`'{}'::text[]`),
  operatorName: text('operator_name'),
  isPublished: boolean('is_published').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Tour ↔ City (ordered). The first city is the tour's "home" city for breadcrumbs. */
export const tourCities = pgTable(
  'tour_cities',
  {
    tourId: text('tour_id')
      .notNull()
      .references(() => tours.id, { onDelete: 'cascade' }),
    cityId: text('city_id')
      .notNull()
      .references(() => cities.id),
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tourId, t.cityId] }), index('tour_cities_city_idx').on(t.cityId)],
);

// ---------- Users & auth ----------

export type TravelPreferences = {
  regions: string[];
  budgetMinAZN: number | null;
  budgetMaxAZN: number | null;
  travelTypes: string[];
};

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fullName: text('full_name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    phone: text('phone'),
    currency: currencyEnum('currency').notNull().default('AZN'),
    preferences: jsonb('preferences')
      .$type<TravelPreferences>()
      .notNull()
      .default({ regions: [], budgetMinAZN: null, budgetMaxAZN: null, travelTypes: [] }),
    notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
    role: userRoleEnum('role').notNull().default('user'),
    googleSub: text('google_sub'),
    appleSub: text('apple_sub'),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(sql`lower(${t.email})`),
    uniqueIndex('users_google_sub_unique').on(t.googleSub),
    uniqueIndex('users_apple_sub_unique').on(t.appleSub),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('refresh_tokens_hash_unique').on(t.tokenHash), index('refresh_tokens_user_idx').on(t.userId)],
);

export const passwordResets = pgTable('password_resets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    apnsToken: text('apns_token').notNull(),
    environment: text('environment').notNull().default('production'), // 'sandbox' | 'production'
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('devices_token_unique').on(t.apnsToken)],
);

// ---------- Personal data ----------

export const favorites = pgTable(
  'favorites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: favoriteTypeEnum('type').notNull(),
    itemId: text('item_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('favorites_unique').on(t.userId, t.type, t.itemId)],
);

export const tourRequests = pgTable(
  'tour_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Human-readable number shown in the app, e.g. TR-2481 */
    code: text('code').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tourId: text('tour_id')
      .notNull()
      .references(() => tours.id),
    startDate: date('start_date'),
    endDate: date('end_date'),
    flexible: boolean('flexible').notNull().default(false),
    adults: integer('adults').notNull(),
    children: integer('children').notNull().default(0),
    contactPhone: text('contact_phone').notNull(),
    contactEmail: text('contact_email').notNull(),
    note: text('note'),
    unitPriceAZN: integer('unit_price_azn').notNull(),
    childUnitPriceAZN: integer('child_unit_price_azn').notNull(),
    totalAZN: integer('total_azn').notNull(),
    /** Currency the user saw when sending — the operator always gets AZN too. */
    displayCurrency: currencyEnum('display_currency').notNull().default('AZN'),
    displayTotal: numeric('display_total', { mode: 'number' }).notNull(),
    status: requestStatusEnum('status').notNull().default('pending'),
    operatorNote: text('operator_note'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('tour_requests_user_idx').on(t.userId, t.createdAt)],
);

export type PlanBudget = {
  stay: number;
  food: number;
  transport: number;
  activities: number;
  flights: number;
  total: number;
};
export type PlanDayItem = { placeId: string | null; name: string; category?: string | null; durationHours?: number | null; priceAZN: number };
export type PlanDay = { day: number; cityId: string; title: string; items: PlanDayItem[]; notes?: string | null };
export type PlanSlots = {
  destination?: string | null;
  travelers?: number | null;
  durationDays?: number | null;
  budgetAZN?: number | null;
  travelTypes?: string[];
  departureCity?: string | null;
  dates?: { flexible: boolean; start?: string | null; end?: string | null } | null;
  flightsIncluded?: boolean | null;
};

export const aiPlans = pgTable(
  'ai_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    days: integer('days').notNull(),
    travelers: integer('travelers').notNull(),
    flightsIncluded: boolean('flights_included').notNull().default(false),
    departureCity: text('departure_city'),
    cityIds: text('city_ids').array().notNull().default(sql`'{}'::text[]`),
    budgetAZN: jsonb('budget_azn').$type<PlanBudget>().notNull(),
    dayPlans: jsonb('day_plans').$type<PlanDay[]>().notNull(),
    relatedTourIds: text('related_tour_ids').array().notNull().default(sql`'{}'::text[]`),
    slots: jsonb('slots').$type<PlanSlots>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_plans_user_idx').on(t.userId, t.createdAt)],
);

/** Daily usage counters for the AI planner (guest limits — open question in PDF §11). */
export const aiUsage = pgTable(
  'ai_usage',
  {
    key: text('key').notNull(), // 'user:<uuid>' | 'ip:<addr>'
    day: date('day').notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.day] })],
);

// ---------- Exchange rates ----------

/** AZN per 1 unit of foreign currency (CBAR convention), e.g. usd = 1.7 */
export const exchangeRates = pgTable('exchange_rates', {
  id: serial('id').primaryKey(),
  aznPerUsd: numeric('azn_per_usd', { mode: 'number' }).notNull(),
  aznPerEur: numeric('azn_per_eur', { mode: 'number' }).notNull(),
  source: text('source').notNull(),
  rateDate: date('rate_date').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Region = typeof regions.$inferSelect;
export type Country = typeof countries.$inferSelect;
export type City = typeof cities.$inferSelect;
export type Place = typeof places.$inferSelect;
export type Stay = typeof stays.$inferSelect;
export type Tour = typeof tours.$inferSelect;
export type User = typeof users.$inferSelect;
export type TourRequest = typeof tourRequests.$inferSelect;
export type AiPlan = typeof aiPlans.$inferSelect;
export type Currency = (typeof currencyEnum.enumValues)[number];
export type RequestStatus = (typeof requestStatusEnum.enumValues)[number];
