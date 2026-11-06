import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { and, desc, eq } from 'drizzle-orm';
import { CatalogStore } from '../catalog/catalog.store';
import { CurrencyQuery } from '../catalog/catalog.dto';
import { presentPlace, presentTourCard } from '../catalog/presenters';
import { ViewContextService } from '../catalog/view-context';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/auth';
import { fieldError } from '../common/validation';
import { DB, Db } from '../db/db.module';
import { favorites } from '../db/schema';

class AddFavoriteDto {
  @ApiProperty({ enum: ['tour', 'place'] })
  @IsIn(['tour', 'place'])
  type: 'tour' | 'place';

  @ApiProperty({ example: 'pyramids-nile-cruise' })
  @IsString()
  @MaxLength(120)
  itemId: string;
}

class RemoveFavoriteQuery {
  @ApiProperty({ enum: ['tour', 'place'] })
  @IsIn(['tour', 'place'])
  type: 'tour' | 'place';

  @ApiProperty()
  @IsString()
  itemId: string;
}

class FavoritesQuery extends CurrencyQuery {
  @ApiPropertyOptional({ enum: ['tour', 'place'], description: 'Tab: Tours / Places. Omit for both.' })
  @IsOptional()
  @IsIn(['tour', 'place'])
  type?: 'tour' | 'place';

  @ApiPropertyOptional({ description: '“Search saved tours / places”' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ example: 'africa', description: 'Tours chip: All, Africa, Europe, Asia' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ example: 1000, description: 'Tours chip “Under 1,000 AZN” — value in `currency`' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ example: 'Sightseeing', description: 'Places chip: Sightseeing, Culture, Nature, Market' })
  @IsOptional()
  @IsString()
  category?: string;
}

@Injectable()
export class FavoritesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly store: CatalogStore,
    private readonly view: ViewContextService,
  ) {}

  async list(user: AuthUser, q: FavoritesQuery) {
    const s = await this.store.get();
    const ctx = await this.view.build(user, q.currency);
    const rows = await this.db.select().from(favorites).where(eq(favorites.userId, user.id)).orderBy(desc(favorites.createdAt));
    const text = q.q?.trim().toLowerCase();
    const maxAZN = q.maxPrice != null ? ctx.pricer.toAZN(q.maxPrice) : null;

    const tours = rows
      .filter((r) => r.type === 'tour' && s.tourById.has(r.itemId))
      .map((r) => ({ fav: r, t: s.tourById.get(r.itemId)! }))
      .filter(({ t }) => !q.region || q.region === 'all' || t.regionIds.includes(q.region))
      .filter(({ t }) => maxAZN == null || t.priceAZN <= maxAZN)
      .filter(({ t }) => !text || [t.title, s.countryById.get(t.countryId)?.name, s.cityById.get(t.cityId)?.name].join(' ').toLowerCase().includes(text))
      .map(({ fav, t }) => ({ favoriteId: fav.id, addedAt: fav.createdAt, tour: presentTourCard(t, s, ctx) }));

    // Places tab is sorted "By country" (PDF §7).
    const places = rows
      .filter((r) => r.type === 'place' && s.placeById.has(r.itemId))
      .map((r) => ({ fav: r, p: s.placeById.get(r.itemId)! }))
      .filter(({ p }) => !q.category || q.category.toLowerCase() === 'all' || p.category.toLowerCase() === q.category.toLowerCase())
      .map(({ fav, p }) => ({ favoriteId: fav.id, addedAt: fav.createdAt, place: presentPlace(p, s, ctx) }))
      .filter(({ place }) => !text || [place.name, place.city?.name, place.country?.name, place.category].join(' ').toLowerCase().includes(text))
      .sort((a, b) => (a.place.country?.name ?? '').localeCompare(b.place.country?.name ?? '') || a.place.name.localeCompare(b.place.name));

    const allTours = rows.filter((r) => r.type === 'tour' && s.tourById.has(r.itemId)).length;
    const allPlaces = rows.filter((r) => r.type === 'place' && s.placeById.has(r.itemId)).length;
    return {
      counts: { tours: allTours, places: allPlaces },
      tours: q.type === 'place' ? [] : tours,
      places: q.type === 'tour' ? [] : places,
      currency: ctx.pricer.currency,
      emptyState: allTours + allPlaces === 0 ? { title: 'No favorites yet', action: 'Explore tours' } : null,
    };
  }

  /** Idempotent: adding twice returns the same favorite. */
  async add(user: AuthUser, dto: AddFavoriteDto) {
    const s = await this.store.get();
    const exists = dto.type === 'tour' ? s.tourById.has(dto.itemId) : s.placeById.has(dto.itemId);
    if (!exists) throw fieldError('itemId', `Unknown ${dto.type}.`, 404);
    await this.db.insert(favorites).values({ userId: user.id, type: dto.type, itemId: dto.itemId }).onConflictDoNothing();
    const [row] = await this.db
      .select()
      .from(favorites)
      .where(and(eq(favorites.userId, user.id), eq(favorites.type, dto.type), eq(favorites.itemId, dto.itemId)));
    return { id: row.id, type: row.type, itemId: row.itemId, createdAt: row.createdAt, isFavorite: true };
  }

  async removeById(user: AuthUser, id: string) {
    const res = await this.db.delete(favorites).where(and(eq(favorites.id, id), eq(favorites.userId, user.id))).returning();
    if (!res.length) throw new NotFoundException('Favorite not found');
    return { type: res[0].type, itemId: res[0].itemId, isFavorite: false };
  }

  async removeByItem(user: AuthUser, type: 'tour' | 'place', itemId: string) {
    await this.db.delete(favorites).where(and(eq(favorites.userId, user.id), eq(favorites.type, type), eq(favorites.itemId, itemId)));
    return { type, itemId, isFavorite: false };
  }
}

@ApiTags('Favorites')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favs: FavoritesService) {}

  @Get()
  @ApiOperation({ summary: 'Favorites: Tours (recently added) and Places (by country), with search + chips' })
  list(@CurrentUser() user: AuthUser, @Query() q: FavoritesQuery) {
    return this.favs.list(user, q);
  }

  @Post()
  @ApiOperation({ summary: 'Heart a tour or place (idempotent; also used for “Undo”)' })
  add(@CurrentUser() user: AuthUser, @Body() dto: AddFavoriteDto) {
    return this.favs.add(user, dto);
  }

  @Delete()
  @HttpCode(200)
  @ApiOperation({ summary: 'Un-heart by item (type + itemId) — convenient from any card' })
  removeByItem(@CurrentUser() user: AuthUser, @Query() q: RemoveFavoriteQuery) {
    return this.favs.removeByItem(user, q.type, q.itemId);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove a favorite by its id' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.favs.removeById(user, id);
  }
}

@Module({ controllers: [FavoritesController], providers: [FavoritesService] })
export class FavoritesModule {}
