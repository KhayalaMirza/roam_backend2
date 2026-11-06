import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AuthUser } from '../common/auth';
import { Pricer } from '../common/money';
import { DB, Db } from '../db/db.module';
import { Currency, favorites } from '../db/schema';
import { RatesService } from '../rates/rates.service';

export type ViewContext = {
  user: AuthUser | null;
  pricer: Pricer;
  isFavorite: (type: 'tour' | 'place', id: string) => boolean;
};

/**
 * Per-request presentation context: which currency to render prices in
 * (?currency= query param > user's Profile setting > AZN) and the user's favorite set,
 * so every card carries the same `isFavorite` state on every screen (PDF §7).
 */
@Injectable()
export class ViewContextService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly rates: RatesService,
  ) {}

  async build(user: AuthUser | null, currency?: Currency | null): Promise<ViewContext> {
    const pricer = this.rates.pricer(currency ?? user?.currency ?? 'AZN');
    let favs = new Set<string>();
    if (user) {
      const rows = await this.db.select({ type: favorites.type, itemId: favorites.itemId }).from(favorites).where(eq(favorites.userId, user.id));
      favs = new Set(rows.map((r) => `${r.type}:${r.itemId}`));
    }
    return { user, pricer, isFavorite: (type, id) => favs.has(`${type}:${id}`) };
  }
}
