import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Module, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { and, eq, sql } from 'drizzle-orm';
import { AuthService, initials } from '../auth/auth.service';
import { CatalogStore } from '../catalog/catalog.store';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/auth';
import { CURRENCIES, TRAVEL_TYPE_IDS, TRAVEL_TYPES } from '../common/constants';
import { fieldError } from '../common/validation';
import { DB, Db } from '../db/db.module';
import { Currency, devices, favorites, TravelPreferences, users } from '../db/schema';
import { RatesService } from '../rates/rates.service';
import { RequestsModule, RequestsService } from '../requests/requests.module';

export class PreferencesDto {
  @ApiPropertyOptional({ example: ['africa', 'europe'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  regions?: string[];

  @ApiPropertyOptional({ example: 500, description: 'Per person, in `currency` (defaults to the profile currency)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  budgetMin?: number | null;

  @ApiPropertyOptional({ example: 2500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  budgetMax?: number | null;

  @ApiPropertyOptional({ example: ['sea', 'nature'] })
  @IsOptional()
  @IsArray()
  @IsIn(TRAVEL_TYPE_IDS, { each: true })
  travelTypes?: string[];

  @ApiPropertyOptional({ enum: CURRENCIES, description: 'Currency of budgetMin/budgetMax' })
  @IsOptional()
  @IsIn(CURRENCIES as unknown as string[])
  currency?: Currency;
}

export class UpdateMeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Enter your full name.' })
  @MaxLength(80)
  fullName?: string;

  @ApiPropertyOptional({ example: '+994 50 123 45 67', nullable: true })
  @IsOptional()
  @Matches(/^\+?[0-9 ()-]{7,20}$/, { message: 'Enter a valid phone number.' })
  phone?: string | null;

  @ApiPropertyOptional({ enum: CURRENCIES })
  @IsOptional()
  @IsIn(CURRENCIES as unknown as string[])
  currency?: Currency;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notificationsEnabled?: boolean;

  @ApiPropertyOptional({ type: PreferencesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PreferencesDto)
  preferences?: PreferencesDto;
}

export class ChangePasswordDto {
  @ApiPropertyOptional({ description: 'Required when the account already has a password' })
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(128)
  newPassword: string;
}

export class DeviceDto {
  @ApiProperty({ description: 'APNs device token (hex)' })
  @IsString()
  @Matches(/^[0-9a-fA-F]{32,200}$/, { message: 'Invalid device token.' })
  token: string;

  @ApiPropertyOptional({ enum: ['sandbox', 'production'], default: 'production' })
  @IsOptional()
  @IsIn(['sandbox', 'production'])
  environment?: 'sandbox' | 'production';
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly auth: AuthService,
    private readonly requests: RequestsService,
    private readonly rates: RatesService,
    private readonly store: CatalogStore,
  ) {}

  async me(userId: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    const pricer = this.rates.pricer(u.currency);
    const [favCounts] = await this.db
      .select({
        tours: sql<number>`count(*) filter (where ${favorites.type} = 'tour')`.mapWith(Number),
        places: sql<number>`count(*) filter (where ${favorites.type} = 'place')`.mapWith(Number),
      })
      .from(favorites)
      .where(eq(favorites.userId, userId));
    const s = await this.store.get();
    const p = u.preferences;
    return {
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      initials: initials(u.fullName),
      phone: u.phone,
      currency: u.currency,
      notificationsEnabled: u.notificationsEnabled,
      language: 'English',
      role: u.role,
      authProviders: [u.passwordHash ? 'password' : null, u.googleSub ? 'google' : null, u.appleSub ? 'apple' : null].filter(Boolean),
      hasPassword: Boolean(u.passwordHash),
      preferences: {
        regions: p.regions.map((id) => ({ id, name: s.regionById.get(id)?.name ?? id })),
        budgetMinAZN: p.budgetMinAZN,
        budgetMaxAZN: p.budgetMaxAZN,
        budgetMin: p.budgetMinAZN != null ? pricer.of(p.budgetMinAZN) : null,
        budgetMax: p.budgetMaxAZN != null ? pricer.of(p.budgetMaxAZN) : null,
        travelTypes: p.travelTypes.map((id) => ({ id, label: TRAVEL_TYPES.find((t) => t.id === id)?.label ?? id })),
      },
      stats: {
        requests: await this.requests.statsFor(userId),
        favorites: favCounts ?? { tours: 0, places: 0 },
      },
      createdAt: u.createdAt,
    };
  }

  private async toPreferences(dto: PreferencesDto, userCurrency: Currency, current: TravelPreferences): Promise<TravelPreferences> {
    const pricer = this.rates.pricer(dto.currency ?? userCurrency);
    const s = await this.store.get();
    const regions = dto.regions?.filter((r) => r !== 'all' && s.regionById.has(r));
    const min = dto.budgetMin === undefined ? current.budgetMinAZN : dto.budgetMin === null ? null : pricer.toAZN(dto.budgetMin);
    const max = dto.budgetMax === undefined ? current.budgetMaxAZN : dto.budgetMax === null ? null : pricer.toAZN(dto.budgetMax);
    if (min != null && max != null && min > max) throw fieldError('preferences.budgetMax', 'Maximum budget must be higher than minimum.');
    return {
      regions: regions ?? current.regions,
      budgetMinAZN: min,
      budgetMaxAZN: max,
      travelTypes: dto.travelTypes ?? current.travelTypes,
    };
  }

  async update(user: AuthUser, dto: UpdateMeDto) {
    const [u] = await this.db.select().from(users).where(eq(users.id, user.id));
    const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (dto.fullName !== undefined) patch.fullName = dto.fullName;
    if (dto.phone !== undefined) patch.phone = dto.phone;
    if (dto.currency !== undefined) patch.currency = dto.currency;
    if (dto.notificationsEnabled !== undefined) patch.notificationsEnabled = dto.notificationsEnabled;
    if (dto.preferences) patch.preferences = await this.toPreferences(dto.preferences, dto.currency ?? u.currency, u.preferences);
    await this.db.update(users).set(patch).where(eq(users.id, user.id));
    return this.me(user.id);
  }

  /** Called by the app on “Show results” so the last-used Home filter becomes Travel preferences (PDF §4.5). */
  async setPreferences(user: AuthUser, dto: PreferencesDto) {
    return this.update(user, { preferences: dto });
  }

  async changePassword(user: AuthUser, dto: ChangePasswordDto) {
    const [u] = await this.db.select().from(users).where(eq(users.id, user.id));
    if (u.passwordHash) {
      if (!dto.currentPassword || !(await this.auth.verifyPassword(dto.currentPassword, u.passwordHash)))
        throw fieldError('currentPassword', 'Current password is incorrect.');
    }
    await this.db.update(users).set({ passwordHash: await this.auth.hashPassword(dto.newPassword), updatedAt: new Date() }).where(eq(users.id, u.id));
    await this.auth.revokeAll(u.id);
    return this.auth.issue(u, false);
  }

  async addDevice(user: AuthUser, dto: DeviceDto) {
    await this.db
      .insert(devices)
      .values({ userId: user.id, apnsToken: dto.token.toLowerCase(), environment: dto.environment ?? 'production' })
      .onConflictDoUpdate({ target: devices.apnsToken, set: { userId: user.id, environment: dto.environment ?? 'production' } });
  }

  async removeDevice(user: AuthUser, token: string) {
    await this.db.delete(devices).where(and(eq(devices.userId, user.id), eq(devices.apnsToken, token.toLowerCase())));
  }

  /** App Store guideline 5.1.1(v): apps with account creation must offer in-app account deletion. */
  async deleteAccount(user: AuthUser) {
    await this.db.delete(users).where(eq(users.id, user.id));
  }
}

@ApiTags('Profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Profile: name, email, initials, phone, currency, travel preferences, request/favorite stats' })
  me(@CurrentUser() user: AuthUser) {
    return this.users.me(user.id);
  }

  @Patch()
  @ApiOperation({ summary: 'Edit profile / change currency / notifications / preferences' })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.users.update(user, dto);
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Save last-used Home filter as Travel preferences' })
  preferences(@CurrentUser() user: AuthUser, @Body() dto: PreferencesDto) {
    return this.users.setPreferences(user, dto);
  }

  @Post('password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Change password (returns a fresh token pair; other sessions are signed out)' })
  password(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.users.changePassword(user, dto);
  }

  @Post('devices')
  @HttpCode(204)
  @ApiOperation({ summary: 'Register APNs device token for request-status push notifications' })
  async addDevice(@CurrentUser() user: AuthUser, @Body() dto: DeviceDto) {
    await this.users.addDevice(user, dto);
  }

  @Delete('devices/:token')
  @HttpCode(204)
  async removeDevice(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    await this.users.removeDevice(user, token);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete account and all personal data' })
  async remove(@CurrentUser() user: AuthUser) {
    await this.users.deleteAccount(user);
  }
}

@Module({ imports: [RequestsModule], controllers: [MeController], providers: [UsersService] })
export class UsersModule {}
