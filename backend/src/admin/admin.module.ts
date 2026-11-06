import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { eq, inArray } from 'drizzle-orm';
import { CatalogStore } from '../catalog/catalog.store';
import { Roles, RolesGuard } from '../common/auth';
import { DB, Db } from '../db/db.module';
import { cities, countries, places, regions, stays, tourCities, tourRequests, tours, users } from '../db/schema';
import { RatesService } from '../rates/rates.service';
import { RequestsModule, RequestsService } from '../requests/requests.module';
import {
  AdminRequestsQuery,
  CityUpsertDto,
  CountryUpsertDto,
  KindSlugParam,
  ManualRatesDto,
  PlaceUpsertDto,
  RegionUpsertDto,
  RequestStatusDto,
  SlugParam,
  StayUpsertDto,
  TourUpsertDto,
} from './admin.dto';

/** FK violations → readable 400s instead of 500s. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: unknown) {
    const err = e as { code?: string; detail?: string; cause?: { code?: string; detail?: string } };
    const code = err.code ?? err.cause?.code;
    if (code === '23503') throw new BadRequestException(err.detail ?? err.cause?.detail ?? 'Referenced item does not exist or is still in use.');
    throw e;
  }
}

@Injectable()
export class AdminCatalogService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly store: CatalogStore,
  ) {}

  private done<T>(v: T) {
    this.store.invalidate();
    return v;
  }

  upsertRegion = (id: string, d: RegionUpsertDto) =>
    guard(async () => this.done((await this.db.insert(regions).values({ id, ...d }).onConflictDoUpdate({ target: regions.id, set: d }).returning())[0]));
  upsertCountry = (id: string, d: CountryUpsertDto) =>
    guard(async () => this.done((await this.db.insert(countries).values({ id, ...d }).onConflictDoUpdate({ target: countries.id, set: d }).returning())[0]));
  upsertCity = (id: string, d: CityUpsertDto) => {
    const b = d.dailyBudgetBreakdown;
    const v = { ...d, dailyBudgetAZN: b.stay + b.food + b.transport + b.activities };
    return guard(async () => this.done((await this.db.insert(cities).values({ id, ...v }).onConflictDoUpdate({ target: cities.id, set: v }).returning())[0]));
  };
  upsertPlace = (id: string, d: PlaceUpsertDto) =>
    guard(async () => this.done((await this.db.insert(places).values({ id, ...d }).onConflictDoUpdate({ target: places.id, set: d }).returning())[0]));
  upsertStay = (id: string, d: StayUpsertDto) =>
    guard(async () => this.done((await this.db.insert(stays).values({ id, ...d }).onConflictDoUpdate({ target: stays.id, set: d }).returning())[0]));

  async upsertTour(id: string, d: TourUpsertDto) {
    const { cityIds, ...rest } = d;
    if (!cityIds.length) throw new BadRequestException('A tour needs at least one city.');
    const known = await this.db.select({ id: cities.id }).from(cities).where(inArray(cities.id, cityIds));
    const missing = cityIds.filter((c) => !known.some((k) => k.id === c));
    if (missing.length) throw new BadRequestException(`Unknown cities: ${missing.join(', ')}`);
    const values = { ...rest, updatedAt: new Date() };
    return guard(() =>
      this.db.transaction(async (tx) => {
        const [t] = await tx.insert(tours).values({ id, ...values }).onConflictDoUpdate({ target: tours.id, set: values }).returning();
        await tx.delete(tourCities).where(eq(tourCities.tourId, id));
        await tx.insert(tourCities).values(cityIds.map((cityId, position) => ({ tourId: id, cityId, position })));
        return this.done({ ...t, cityIds });
      }),
    );
  }

  /** Tours with requests can't be hard-deleted — they are unpublished instead. */
  async deleteTour(id: string) {
    const used = await this.db.select({ id: tourRequests.id }).from(tourRequests).where(eq(tourRequests.tourId, id)).limit(1);
    if (used.length) {
      await this.db.update(tours).set({ isPublished: false, updatedAt: new Date() }).where(eq(tours.id, id));
      return this.done({ id, unpublished: true });
    }
    await this.db.delete(tours).where(eq(tours.id, id));
    return this.done({ id, deleted: true });
  }

  deleteEntity(kind: 'regions' | 'countries' | 'cities' | 'places' | 'stays', id: string) {
    const table = { regions, countries, cities, places, stays }[kind];
    return guard(async () => {
      await this.db.delete(table).where(eq(table.id, id));
      return this.done({ id, deleted: true });
    });
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('admin')
@Controller('admin/catalog')
export class AdminCatalogController {
  constructor(private readonly svc: AdminCatalogService) {}

  @Put('regions/:id') region(@Param() p: SlugParam, @Body() d: RegionUpsertDto) {
    return this.svc.upsertRegion(p.id, d);
  }
  @Put('countries/:id') country(@Param() p: SlugParam, @Body() d: CountryUpsertDto) {
    return this.svc.upsertCountry(p.id, d);
  }
  @Put('cities/:id') city(@Param() p: SlugParam, @Body() d: CityUpsertDto) {
    return this.svc.upsertCity(p.id, d);
  }
  @Put('places/:id') place(@Param() p: SlugParam, @Body() d: PlaceUpsertDto) {
    return this.svc.upsertPlace(p.id, d);
  }
  @Put('stays/:id') stay(@Param() p: SlugParam, @Body() d: StayUpsertDto) {
    return this.svc.upsertStay(p.id, d);
  }
  @Put('tours/:id') tour(@Param() p: SlugParam, @Body() d: TourUpsertDto) {
    return this.svc.upsertTour(p.id, d);
  }
  @Delete('tours/:id') deleteTour(@Param() p: SlugParam) {
    return this.svc.deleteTour(p.id);
  }
  @Delete(':kind/:id')
  @ApiOperation({ summary: 'Delete region/country/city/place/stay (fails with 400 while referenced)' })
  delete(@Param() p: KindSlugParam) {
    return this.svc.deleteEntity(p.kind, p.id);
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('admin', 'operator')
@Controller('admin')
export class AdminOpsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly rates: RatesService,
    @Inject(DB) private readonly db: Db,
  ) {}

  @Get('requests')
  @ApiOperation({ summary: 'Operator inbox: all tour requests (AZN amounts)' })
  async list(@Query() q: AdminRequestsQuery) {
    const rows = await this.requests.listAll(q.status);
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const us = userIds.length ? await this.db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, userIds)) : [];
    return rows.map((r) => ({ ...r, customerName: us.find((u) => u.id === r.userId)?.fullName ?? null }));
  }

  @Patch('requests/:id')
  @ApiOperation({ summary: 'Confirm / complete / cancel a request — sends a push notification to the traveler' })
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() d: RequestStatusDto) {
    return this.requests.setStatus(id, d.status, d.operatorNote);
  }

  @Post('rates/refresh')
  @HttpCode(200)
  @Roles('admin')
  @ApiOperation({ summary: 'Fetch today’s CBAR rates now' })
  refreshRates() {
    return this.rates.refresh();
  }

  @Put('rates')
  @Roles('admin')
  @ApiOperation({ summary: 'Set rates manually (e.g. when CBAR is unreachable)' })
  setRates(@Body() d: ManualRatesDto) {
    return this.rates.setManual(d.aznPerUsd, d.aznPerEur);
  }
}

@Module({ imports: [RequestsModule], controllers: [AdminCatalogController, AdminOpsController], providers: [AdminCatalogService] })
export class AdminModule {}
