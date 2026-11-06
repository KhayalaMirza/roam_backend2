import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { CatalogStore } from '../catalog/catalog.store';
import { CurrencyQuery } from '../catalog/catalog.dto';
import { durationLabel, ref } from '../catalog/presenters';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/auth';
import { REQUEST_DISCLAIMER, REQUEST_NEXT_STEPS, REQUEST_STATUS_LABELS } from '../common/constants';
import { Pricer } from '../common/money';
import { fieldError } from '../common/validation';
import { DB, Db } from '../db/db.module';
import { RequestStatus, TourRequest, tourRequests } from '../db/schema';
import { OperatorNotifier, PushService } from '../notifications/notifications.module';
import { RatesService } from '../rates/rates.service';

export class CreateRequestDto extends CurrencyQuery {
  @ApiProperty({ example: 'pyramids-nile-cruise' })
  @IsString()
  tourId: string;

  @ApiProperty({ description: '“I’m flexible” toggle. When false, startDate is required.' })
  @IsBoolean()
  flexible: boolean;

  @ApiPropertyOptional({ example: '2027-03-12', description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Pick a valid start date.' })
  startDate?: string;

  @ApiPropertyOptional({ example: '2027-03-16', description: 'YYYY-MM-DD. Defaults to startDate + tour nights.' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Pick a valid end date.' })
  endDate?: string;

  @ApiProperty({ minimum: 1, maximum: 20, description: 'Adults (12+)' })
  @IsInt()
  @Min(1, { message: 'At least one adult is required.' })
  @Max(20)
  adults: number;

  @ApiProperty({ minimum: 0, maximum: 20, description: 'Children (2–11)' })
  @IsInt()
  @Min(0)
  @Max(20)
  children: number;

  @ApiPropertyOptional({ example: '+994 50 123 45 67', description: 'Defaults to profile phone' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^\+?[0-9 ()-]{7,20}$/, { message: 'Enter a valid phone number.' })
  phone?: string;

  @ApiPropertyOptional({ description: 'Defaults to account email' })
  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address.' })
  email?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RequestsQuery extends CurrencyQuery {
  @ApiPropertyOptional({ enum: ['all', 'pending', 'confirmed', 'past'], description: 'My requests tabs' })
  @IsOptional()
  @IsIn(['all', 'pending', 'confirmed', 'past'])
  status?: 'all' | 'pending' | 'confirmed' | 'past';
}

const today = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10); // Baku date
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function isPast(r: Pick<TourRequest, 'status' | 'endDate'>) {
  return r.status === 'completed' || r.status === 'cancelled' || (r.endDate != null && r.endDate < today() && r.status !== 'pending');
}

@Injectable()
export class RequestsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly store: CatalogStore,
    private readonly rates: RatesService,
    private readonly operator: OperatorNotifier,
    private readonly push: PushService,
  ) {}

  /** Live price quote for the “Request this tour” screen (980 AZN × 2 adults = 1,960 AZN). */
  async quote(tourId: string, adults: number, children: number, pricer: Pricer) {
    const s = await this.store.get();
    const t = s.tourById.get(tourId);
    if (!t) throw fieldError('tourId', 'This tour is no longer available.', 404);
    const child = t.childPriceAZN ?? t.priceAZN;
    const totalAZN = t.priceAZN * adults + child * children;
    const lines = [
      { label: `${pricer.of(t.priceAZN).formatted} × ${adults} adult${adults === 1 ? '' : 's'}`, amount: pricer.of(t.priceAZN * adults) },
      ...(children
        ? [{ label: `${pricer.of(child).formatted} × ${children} child${children === 1 ? '' : 'ren'}`, amount: pricer.of(child * children) }]
        : []),
    ];
    return { tour: t, unitAZN: t.priceAZN, childAZN: child, totalAZN, total: pricer.of(totalAZN), totalInAZN: pricer.with('AZN').of(totalAZN), lines };
  }

  async create(user: AuthUser, dto: CreateRequestDto) {
    const pricer = this.rates.pricer(dto.currency ?? user.currency);
    let start = dto.startDate ?? null;
    let end = dto.endDate ?? null;
    const q = await this.quote(dto.tourId, dto.adults, dto.children, pricer);
    if (!dto.flexible) {
      if (!start) throw fieldError('startDate', 'Pick your travel dates or choose “I’m flexible”.');
      if (start < today()) throw fieldError('startDate', 'Travel dates must be in the future.');
      end = end ?? addDays(start, q.tour.nights);
      if (end < start) throw fieldError('endDate', 'End date must be after the start date.');
    } else if (start && start < today()) {
      start = null;
      end = null;
    }
    const phone = dto.phone ?? user.phone;
    if (!phone) throw fieldError('phone', 'Add a phone number so the operator can reach you.');
    const email = dto.email ?? user.email;

    const [row] = await this.db
      .insert(tourRequests)
      .values({
        code: sql`'TR-' || nextval('tour_request_code_seq')`,
        userId: user.id,
        tourId: q.tour.id,
        startDate: start,
        endDate: end,
        flexible: dto.flexible,
        adults: dto.adults,
        children: dto.children,
        contactPhone: phone,
        contactEmail: email,
        note: dto.note ?? null,
        unitPriceAZN: q.unitAZN,
        childUnitPriceAZN: q.childAZN,
        totalAZN: q.totalAZN,
        displayCurrency: pricer.currency,
        displayTotal: q.total.amount,
      })
      .returning();

    void this.operator.notify({
      event: 'request.created',
      request: {
        code: row.code,
        tourId: row.tourId,
        tourTitle: q.tour.title,
        startDate: row.startDate,
        endDate: row.endDate,
        flexible: row.flexible,
        adults: row.adults,
        children: row.children,
        contactName: user.fullName,
        contactPhone: row.contactPhone,
        contactEmail: row.contactEmail,
        note: row.note,
        totalAZN: row.totalAZN,
        displayCurrency: row.displayCurrency,
        displayTotal: row.displayTotal,
        createdAt: row.createdAt.toISOString(),
      },
    });

    return {
      ...(await this.present(row, pricer)),
      nextSteps: REQUEST_NEXT_STEPS,
      noPaymentNote: 'No payment in the app.',
    };
  }

  async present(r: TourRequest, pricer: Pricer) {
    const s = await this.store.get();
    const t = s.tourById.get(r.tourId);
    const travelers = r.adults + r.children;
    return {
      id: r.id,
      code: r.code,
      status: r.status,
      statusLabel: REQUEST_STATUS_LABELS[r.status],
      isPast: isPast(r),
      tour: t
        ? {
            id: t.id,
            title: t.title,
            country: ref(s.countryById.get(t.countryId)),
            city: ref(s.cityById.get(t.cityId)),
            durationLabel: durationLabel(t.days, t.nights),
            coverImageUrl: t.images[0] ?? null,
          }
        : { id: r.tourId, title: 'Tour no longer available', country: null, city: null, durationLabel: null, coverImageUrl: null },
      startDate: r.startDate,
      endDate: r.endDate,
      flexible: r.flexible,
      datesLabel: r.flexible && !r.startDate ? 'Flexible dates' : `${r.startDate} – ${r.endDate}`,
      adults: r.adults,
      children: r.children,
      travelersLabel: `${travelers} traveler${travelers === 1 ? '' : 's'}`,
      contactPhone: r.contactPhone,
      contactEmail: r.contactEmail,
      note: r.note,
      total: pricer.of(r.totalAZN),
      totalAZN: r.totalAZN,
      operatorNote: r.operatorNote,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      disclaimer: REQUEST_DISCLAIMER,
    };
  }

  async list(user: AuthUser, q: RequestsQuery) {
    const pricer = this.rates.pricer(q.currency ?? user.currency);
    const rows = await this.db.select().from(tourRequests).where(eq(tourRequests.userId, user.id)).orderBy(desc(tourRequests.createdAt));
    const filter = q.status ?? 'all';
    const filtered = rows.filter((r) => {
      if (filter === 'pending') return r.status === 'pending';
      if (filter === 'confirmed') return r.status === 'confirmed' && !isPast(r);
      if (filter === 'past') return isPast(r);
      return true;
    });
    return {
      counts: {
        all: rows.length,
        pending: rows.filter((r) => r.status === 'pending').length,
        confirmed: rows.filter((r) => r.status === 'confirmed' && !isPast(r)).length,
        past: rows.filter(isPast).length,
      },
      items: await Promise.all(filtered.map((r) => this.present(r, pricer))),
      disclaimer: REQUEST_DISCLAIMER,
    };
  }

  async get(user: AuthUser, id: string, currency?: CurrencyQuery['currency']) {
    const [r] = await this.db.select().from(tourRequests).where(and(eq(tourRequests.id, id), eq(tourRequests.userId, user.id)));
    if (!r) throw new NotFoundException('Request not found');
    return this.present(r, this.rates.pricer(currency ?? user.currency));
  }

  async cancel(user: AuthUser, id: string) {
    const [r] = await this.db.select().from(tourRequests).where(and(eq(tourRequests.id, id), eq(tourRequests.userId, user.id)));
    if (!r) throw new NotFoundException('Request not found');
    if (!['pending', 'confirmed'].includes(r.status)) throw new BadRequestException('This request can no longer be cancelled.');
    const [row] = await this.db
      .update(tourRequests)
      .set({ status: 'cancelled', statusChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(tourRequests.id, id))
      .returning();
    const s = await this.store.get();
    void this.operator.notify({
      event: 'request.cancelled',
      request: {
        code: row.code,
        tourId: row.tourId,
        tourTitle: s.tourById.get(row.tourId)?.title ?? row.tourId,
        startDate: row.startDate,
        endDate: row.endDate,
        flexible: row.flexible,
        adults: row.adults,
        children: row.children,
        contactName: user.fullName,
        contactPhone: row.contactPhone,
        contactEmail: row.contactEmail,
        note: row.note,
        totalAZN: row.totalAZN,
        displayCurrency: row.displayCurrency,
        displayTotal: row.displayTotal,
        createdAt: row.createdAt.toISOString(),
      },
    });
    return this.present(row, this.rates.pricer(user.currency));
  }

  /** Operator/admin status change → push notification to the traveler (PDF §11). */
  async setStatus(id: string, status: RequestStatus, operatorNote?: string | null) {
    const [row] = await this.db
      .update(tourRequests)
      .set({ status, operatorNote: operatorNote ?? undefined, statusChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(tourRequests.id, id))
      .returning();
    if (!row) throw new NotFoundException('Request not found');
    const s = await this.store.get();
    const title = s.tourById.get(row.tourId)?.title ?? 'your tour';
    const messages: Partial<Record<RequestStatus, string>> = {
      confirmed: `The operator confirmed ${title}. They will contact you with the details.`,
      completed: `Hope you enjoyed ${title}!`,
      cancelled: `Your request for ${title} was cancelled.`,
    };
    if (messages[status]) {
      void this.push.sendToUser(row.userId, {
        title: `Request ${row.code}: ${REQUEST_STATUS_LABELS[status]}`,
        body: messages[status]!,
        data: { type: 'request.status', requestId: row.id, status },
      });
    }
    return row;
  }

  async listAll(status?: RequestStatus) {
    const where = status ? inArray(tourRequests.status, [status]) : undefined;
    return this.db.select().from(tourRequests).where(where).orderBy(desc(tourRequests.createdAt)).limit(500);
  }

  async statsFor(userId: string) {
    const rows = await this.db.select({ status: tourRequests.status }).from(tourRequests).where(eq(tourRequests.userId, userId));
    const pending = rows.filter((r) => r.status === 'pending').length;
    return {
      total: rows.length,
      pending,
      /** “3 tour requests · 1 waiting for operator” */
      label: `${rows.length} tour request${rows.length === 1 ? '' : 's'}${pending ? ` · ${pending} waiting for operator` : ''}`,
    };
  }
}

class QuoteQuery extends CurrencyQuery {
  @ApiProperty()
  @IsString()
  tourId: string;

  @ApiProperty()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(20)
  adults: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  @Max(20)
  children?: number;
}

@ApiTags('Requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('requests')
export class RequestsController {
  constructor(
    private readonly requests: RequestsService,
    private readonly rates: RatesService,
  ) {}

  @Get('quote')
  @ApiOperation({ summary: 'Price breakdown for the request form (no side effects)' })
  async quote(@CurrentUser() user: AuthUser, @Query() q: QuoteQuery) {
    const pricer = this.rates.pricer(q.currency ?? user.currency);
    const r = await this.requests.quote(q.tourId, q.adults, q.children ?? 0, pricer);
    return { tourId: r.tour.id, lines: r.lines, total: r.total, totalAZN: r.totalAZN, totalInAZN: r.totalInAZN, note: 'No payment in the app.' };
  }

  @Post()
  @ApiOperation({ summary: '“Send request” → returns the Request sent payload (#TR-xxxx + next steps)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRequestDto) {
    return this.requests.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'My requests (tabs: all, pending, confirmed, past)' })
  list(@CurrentUser() user: AuthUser, @Query() q: RequestsQuery) {
    return this.requests.list(user, q);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: CurrencyQuery) {
    return this.requests.get(user, id, q.currency);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Withdraw a request' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.cancel(user, id);
  }
}

@Module({ controllers: [RequestsController], providers: [RequestsService], exports: [RequestsService] })
export class RequestsModule {}
