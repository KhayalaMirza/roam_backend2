import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, OptionalAuthGuard } from '../common/auth';
import { CurrencyQuery, RegionQuery, ToursQuery } from './catalog.dto';
import { CatalogService } from './catalog.service';
import { ViewContextService } from './view-context';

@ApiTags('Catalog')
@ApiBearerAuth()
@UseGuards(OptionalAuthGuard)
@Controller()
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly view: ViewContextService,
  ) {}

  @Get('regions')
  @ApiOperation({ summary: 'Region chips: All, Europe, Asia, Middle East, Africa' })
  regions() {
    return this.catalog.regions();
  }

  @Get('countries')
  @ApiOperation({ summary: 'Countries list (optionally by region)' })
  countries(@Query() q: RegionQuery) {
    return this.catalog.countries(q.regionId);
  }

  @Get('countries/:id')
  @ApiOperation({ summary: 'Country detail with info cards and cities' })
  async country(@Param('id') id: string, @Query() q: CurrencyQuery, @CurrentUser() user: AuthUser | null) {
    return this.catalog.country(id, await this.view.build(user, q.currency));
  }

  @Get('cities/:id')
  @ApiOperation({ summary: 'City detail: recommended stay, daily budget, transport, places & activities, stays' })
  async city(@Param('id') id: string, @Query() q: CurrencyQuery, @CurrentUser() user: AuthUser | null) {
    return this.catalog.city(id, await this.view.build(user, q.currency));
  }

  @Get('places/:id')
  @ApiOperation({ summary: 'Single place' })
  async place(@Param('id') id: string, @Query() q: CurrencyQuery, @CurrentUser() user: AuthUser | null) {
    return this.catalog.place(id, await this.view.build(user, q.currency));
  }

  @Get('tours')
  @ApiOperation({ summary: 'Home list + Filter results (region, countries, budget, duration, travel type, sort)' })
  async tours(@Query() q: ToursQuery, @CurrentUser() user: AuthUser | null) {
    return this.catalog.tours(q, await this.view.build(user, q.currency));
  }

  @Get('tours/filters')
  @ApiOperation({ summary: 'Options for the Filter bottom sheet (countries depend on region)' })
  async filters(@Query() q: RegionQuery, @CurrentUser() user: AuthUser | null) {
    return this.catalog.filterOptions(q.regionId, await this.view.build(user, q.currency));
  }

  @Get('tours/:id')
  @ApiOperation({ summary: 'Tour detail + Full plan (overview, itinerary, stays, budget, map)' })
  async tour(@Param('id') id: string, @Query() q: CurrencyQuery, @CurrentUser() user: AuthUser | null) {
    return this.catalog.tour(id, await this.view.build(user, q.currency));
  }
}
