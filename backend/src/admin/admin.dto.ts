import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PLACE_CATEGORIES, TRAVEL_TYPE_IDS } from '../common/constants';

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class RegionUpsertDto {
  @ApiProperty() @IsString() @MaxLength(60) name: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
}

export class CountryUpsertDto {
  @ApiProperty() @IsString() regionId: string;
  @ApiProperty() @IsString() @MaxLength(80) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiProperty({ example: 'Egyptian pound' }) @IsString() currency: string;
  @ApiProperty({ example: 'Arabic' }) @IsString() language: string;
  @ApiProperty({ example: 'Oct – Apr' }) @IsString() bestSeason: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl() imageUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) flightFromBakuAZN?: number;
}

class DailyBudgetDto {
  @ApiProperty() @IsInt() @Min(0) stay: number;
  @ApiProperty() @IsInt() @Min(0) food: number;
  @ApiProperty() @IsInt() @Min(0) transport: number;
  @ApiProperty() @IsInt() @Min(0) activities: number;
}

export class CityUpsertDto {
  @ApiProperty() @IsString() countryId: string;
  @ApiProperty() @IsString() @MaxLength(80) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) shortDescription?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl() imageUrl?: string | null;
  @ApiProperty() @IsInt() @Min(1) @Max(30) recommendedDays: number;
  @ApiProperty({ type: DailyBudgetDto }) @ValidateNested() @Type(() => DailyBudgetDto) dailyBudgetBreakdown: DailyBudgetDto;
  @ApiPropertyOptional({ example: ['Metro', 'Ride-hailing', 'Taxi'] }) @IsOptional() @IsArray() @IsString({ each: true }) transport?: string[];
  @ApiPropertyOptional() @IsOptional() @IsNumber() lat?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() lng?: number | null;
}

export class PlaceUpsertDto {
  @ApiProperty() @IsString() cityId: string;
  @ApiProperty() @IsString() @MaxLength(120) name: string;
  @ApiProperty({ enum: PLACE_CATEGORIES }) @IsIn(PLACE_CATEGORIES as unknown as string[]) category: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiProperty() @IsNumber() @Min(0) durationHours: number;
  @ApiProperty() @IsInt() @Min(0) priceAZN: number;
  @ApiPropertyOptional() @IsOptional() @IsUrl() imageUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() lat?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() lng?: number | null;
}

export class StayUpsertDto {
  @ApiProperty() @IsString() cityId: string;
  @ApiProperty() @IsString() @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() kind?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(5) stars?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) pricePerNightAZN?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsUrl() websiteUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUrl() imageUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() lat?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() lng?: number | null;
}

class ItineraryItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() placeId?: string | null;
  @ApiProperty() @IsString() @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() durationHours?: number | null;
  @ApiProperty() @IsBoolean() included: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() optional?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) extraPriceAZN?: number | null;
}

class ItineraryDayDto {
  @ApiProperty() @IsInt() @Min(1) day: number;
  @ApiProperty() @IsString() @MaxLength(120) title: string;
  @ApiProperty() @IsString() cityId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiProperty({ type: [ItineraryItemDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => ItineraryItemDto) items: ItineraryItemDto[];
}

class TourStayDto {
  @ApiProperty() @IsString() stayId: string;
  @ApiProperty() @IsInt() @Min(1) nights: number;
}

export class TourUpsertDto {
  @ApiProperty() @IsString() @MaxLength(120) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) summary?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @ApiProperty({ description: 'Ordered city ids; the first is the tour’s home city' }) @IsArray() @IsString({ each: true }) cityIds: string[];
  @ApiProperty() @IsInt() @Min(1) days: number;
  @ApiProperty() @IsInt() @Min(0) nights: number;
  @ApiProperty() @IsInt() @Min(0) priceAZN: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) childPriceAZN?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsIn(TRAVEL_TYPE_IDS, { each: true }) travelTypes?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @ApiPropertyOptional({ type: [ItineraryDayDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ItineraryDayDto) itinerary?: ItineraryDayDto[];
  @ApiPropertyOptional({ type: [TourStayDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TourStayDto) stays?: TourStayDto[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) included?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) excluded?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsUrl({}, { each: true }) images?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() operatorName?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPublished?: boolean;
}

export class RequestStatusDto {
  @ApiProperty({ enum: ['pending', 'confirmed', 'completed', 'cancelled'] })
  @IsIn(['pending', 'confirmed', 'completed', 'cancelled'])
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  operatorNote?: string;
}

export class AdminRequestsQuery {
  @ApiPropertyOptional({ enum: ['pending', 'confirmed', 'completed', 'cancelled'] })
  @IsOptional()
  @IsIn(['pending', 'confirmed', 'completed', 'cancelled'])
  status?: 'pending' | 'confirmed' | 'completed' | 'cancelled';
}

export class ManualRatesDto {
  @ApiProperty({ example: 1.7 }) @IsNumber() @Min(0.01) aznPerUsd: number;
  @ApiProperty({ example: 1.98 }) @IsNumber() @Min(0.01) aznPerEur: number;
}

export class SlugParam {
  @Matches(SLUG, { message: 'id must be a lowercase slug, e.g. "pyramids-nile-cruise"' })
  id: string;
}

export class KindSlugParam extends SlugParam {
  @IsIn(['regions', 'countries', 'cities', 'places', 'stays'])
  kind: 'regions' | 'countries' | 'cities' | 'places' | 'stays';
}
