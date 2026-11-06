import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CURRENCIES, DURATION_IDS, SORT_IDS, TRAVEL_TYPE_IDS } from '../common/constants';
import type { Currency } from '../db/schema';

const csv = () =>
  Transform(({ value }) => {
    if (value == null || value === '') return undefined;
    const arr = Array.isArray(value) ? value : String(value).split(',');
    return arr.map((v: string) => v.trim()).filter(Boolean);
  });

export class CurrencyQuery {
  @ApiPropertyOptional({ enum: CURRENCIES, description: 'Display currency. Defaults to the user’s Profile currency, then AZN.' })
  @IsOptional()
  @IsIn(CURRENCIES as unknown as string[])
  currency?: Currency;
}

export class RegionQuery extends CurrencyQuery {
  @ApiPropertyOptional({ example: 'africa', description: 'Region id; "all" or empty for all' })
  @IsOptional()
  @IsString()
  regionId?: string;
}

export class ToursQuery extends CurrencyQuery {
  @ApiPropertyOptional({ example: 'africa', description: 'Single region id (“all” = no filter)' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ example: 'egypt,morocco', description: 'Comma-separated country ids (multi-select)' })
  @IsOptional()
  @csv()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  country?: string[];

  @ApiPropertyOptional({ example: 'cairo', description: 'City id — used by City detail → “View tours”' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 500, description: 'Per person, in `currency`' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  budgetMin?: number;

  @ApiPropertyOptional({ example: 2500, description: 'Per person, in `currency`' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  budgetMax?: number;

  @ApiPropertyOptional({ enum: DURATION_IDS })
  @IsOptional()
  @IsIn(DURATION_IDS)
  duration?: string;

  @ApiPropertyOptional({ example: 'sea,nature', description: `Comma-separated: ${TRAVEL_TYPE_IDS.join(', ')}` })
  @IsOptional()
  @csv()
  @IsArray()
  @IsIn(TRAVEL_TYPE_IDS, { each: true })
  type?: string[];

  @ApiPropertyOptional({ enum: SORT_IDS })
  @IsOptional()
  @IsIn(SORT_IDS)
  sort?: string;

  @ApiPropertyOptional({ description: 'Free-text search on title / country / city' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
