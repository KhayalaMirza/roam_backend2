import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { desc } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../config/env';
import { DB, Db } from '../db/db.module';
import { Currency, exchangeRates } from '../db/schema';
import { Pricer, RatesSnapshot } from '../common/money';

export type RatesResponse = {
  base: 'AZN';
  /** How many units of each currency 1 AZN buys — multiply AZN prices by these on the device. */
  rates: Record<Currency, number>;
  /** CBAR convention: AZN per 1 unit of currency. */
  aznPer: Record<Currency, number>;
  rateDate: string;
  source: string;
  updatedAt: string;
};

export function parseCbarXml(xml: string): { usd: number; eur: number } | null {
  const pick = (code: string) => {
    const m = xml.match(new RegExp(`<Valute\\s+Code="${code}">[\\s\\S]*?<Nominal>([\\d.]+)</Nominal>[\\s\\S]*?<Value>([\\d.]+)</Value>`));
    if (!m) return null;
    return Number(m[2]) / Number(m[1] || 1);
  };
  const usd = pick('USD');
  const eur = pick('EUR');
  return usd && eur ? { usd, eur } : null;
}

@Injectable()
export class RatesService implements OnModuleInit {
  private readonly log = new Logger(RatesService.name);
  private cache: (RatesSnapshot & { rateDate: string; source: string; fetchedAt: Date }) | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async onModuleInit() {
    await this.loadLatest();
    const stale = !this.cache || Date.now() - this.cache.fetchedAt.getTime() > 24 * 3600 * 1000;
    if (stale && !this.cfg.rates.disableFetch) void this.refresh().catch(() => undefined);
  }

  private async loadLatest() {
    const [row] = await this.db.select().from(exchangeRates).orderBy(desc(exchangeRates.fetchedAt)).limit(1);
    if (row) {
      this.cache = { aznPerUsd: row.aznPerUsd, aznPerEur: row.aznPerEur, rateDate: row.rateDate, source: row.source, fetchedAt: row.fetchedAt };
    }
  }

  /** Synchronous snapshot — never blocks a request on the network. Falls back to configured defaults. */
  snapshot(): RatesSnapshot & { rateDate: string; source: string; fetchedAt: Date } {
    return (
      this.cache ?? {
        aznPerUsd: this.cfg.rates.fallbackAznPerUsd,
        aznPerEur: this.cfg.rates.fallbackAznPerEur,
        rateDate: new Date().toISOString().slice(0, 10),
        source: 'fallback',
        fetchedAt: new Date(0),
      }
    );
  }

  pricer(currency: Currency | null | undefined): Pricer {
    return new Pricer(currency ?? 'AZN', this.snapshot());
  }

  response(): RatesResponse {
    const s = this.snapshot();
    const r4 = (n: number) => Math.round(n * 10000) / 10000;
    return {
      base: 'AZN',
      rates: { AZN: 1, USD: r4(1 / s.aznPerUsd), EUR: r4(1 / s.aznPerEur) },
      aznPer: { AZN: 1, USD: s.aznPerUsd, EUR: s.aznPerEur },
      rateDate: s.rateDate,
      source: s.source,
      updatedAt: s.fetchedAt.toISOString(),
    };
  }

  /** Daily at 10:05 Baku time (CBAR publishes in the morning). */
  @Cron('5 10 * * *', { timeZone: 'Asia/Baku', name: 'rates-refresh', disabled: process.env.DISABLE_CRON === 'true' })
  async scheduledRefresh() {
    if (this.cfg.rates.disableFetch) return;
    await this.refresh().catch((e) => this.log.warn(`Scheduled rates refresh failed: ${e}`));
  }

  async refresh(): Promise<RatesResponse> {
    const now = new Date(Date.now() + 4 * 3600 * 1000); // Baku date
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dateStr = `${dd}.${mm}.${now.getUTCFullYear()}`;
    const url = this.cfg.rates.cbarUrlTemplate.replace('{date}', dateStr);
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`CBAR responded ${res.status}`);
    const parsed = parseCbarXml(await res.text());
    if (!parsed) throw new Error('Could not parse CBAR XML');
    const [row] = await this.db
      .insert(exchangeRates)
      .values({ aznPerUsd: parsed.usd, aznPerEur: parsed.eur, source: 'CBAR', rateDate: now.toISOString().slice(0, 10) })
      .returning();
    this.cache = { aznPerUsd: row.aznPerUsd, aznPerEur: row.aznPerEur, rateDate: row.rateDate, source: row.source, fetchedAt: row.fetchedAt };
    this.log.log(`Rates updated: 1 USD = ${parsed.usd} AZN, 1 EUR = ${parsed.eur} AZN`);
    return this.response();
  }

  /** Admin override / seeding. */
  async setManual(aznPerUsd: number, aznPerEur: number, source = 'manual') {
    const [row] = await this.db
      .insert(exchangeRates)
      .values({ aznPerUsd, aznPerEur, source, rateDate: new Date().toISOString().slice(0, 10) })
      .returning();
    this.cache = { aznPerUsd: row.aznPerUsd, aznPerEur: row.aznPerEur, rateDate: row.rateDate, source: row.source, fetchedAt: row.fetchedAt };
    return this.response();
  }
}
