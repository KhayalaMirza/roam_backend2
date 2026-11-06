import type { Currency } from '../db/schema';

export type RatesSnapshot = {
  /** AZN per 1 USD / EUR (CBAR convention) */
  aznPerUsd: number;
  aznPerEur: number;
};

export type Money = {
  amount: number;
  currency: Currency;
  /** "980 AZN" | "€520" | "$576" (PDF §8) */
  formatted: string;
};

export function convertFromAZN(azn: number, to: Currency, r: RatesSnapshot): number {
  if (to === 'AZN') return azn;
  const v = to === 'USD' ? azn / r.aznPerUsd : azn / r.aznPerEur;
  return Math.round(v);
}

export function convertToAZN(amount: number, from: Currency, r: RatesSnapshot): number {
  if (from === 'AZN') return amount;
  return Math.round(from === 'USD' ? amount * r.aznPerUsd : amount * r.aznPerEur);
}

export function formatMoney(amount: number, currency: Currency): string {
  const n = Math.round(amount).toLocaleString('en-US');
  switch (currency) {
    case 'EUR':
      return `€${n}`;
    case 'USD':
      return `$${n}`;
    default:
      return `${n} AZN`;
  }
}

export function money(azn: number, currency: Currency, r: RatesSnapshot): Money {
  const amount = convertFromAZN(azn, currency, r);
  return { amount, currency, formatted: formatMoney(amount, currency) };
}

/** Helper bound to a request's currency + rates so presenters stay terse. */
export class Pricer {
  constructor(
    readonly currency: Currency,
    readonly rates: RatesSnapshot,
  ) {}
  of(azn: number): Money {
    return money(azn, this.currency, this.rates);
  }
  toAZN(amount: number): number {
    return convertToAZN(amount, this.currency, this.rates);
  }
  with(currency: Currency): Pricer {
    return new Pricer(currency, this.rates);
  }
}
