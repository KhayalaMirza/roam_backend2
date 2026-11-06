import { Global, Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { CatalogStore } from './catalog.store';
import { ViewContextService } from './view-context';

@Global()
@Module({
  controllers: [CatalogController],
  providers: [CatalogStore, CatalogService, ViewContextService],
  exports: [CatalogStore, CatalogService, ViewContextService],
})
export class CatalogModule {}
