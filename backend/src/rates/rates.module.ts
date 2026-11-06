import { Controller, Get, Global, Header, Module } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RatesService } from './rates.service';

@ApiTags('Rates')
@Controller('rates')
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=3600')
  @ApiOperation({ summary: 'Current AZN exchange rates (cache on device; use last value offline)' })
  @ApiOkResponse({
    schema: {
      example: {
        base: 'AZN',
        rates: { AZN: 1, USD: 0.5882, EUR: 0.5051 },
        aznPer: { AZN: 1, USD: 1.7, EUR: 1.98 },
        rateDate: '2026-11-05',
        source: 'CBAR',
        updatedAt: '2026-11-05T06:05:00.000Z',
      },
    },
  })
  get() {
    return this.rates.response();
  }
}

@Global()
@Module({ providers: [RatesService], controllers: [RatesController], exports: [RatesService] })
export class RatesModule {}
