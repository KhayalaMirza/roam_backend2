import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { createValidationPipe } from './common/validation';
import { loadConfig } from './config/env';

export const API_PREFIX = 'v1';

/** Shared by main.ts, the e2e tests and the OpenAPI exporter so they all see the same app. */
export function configureApp(app: INestApplication) {
  const cfg = loadConfig();
  (app as NestExpressApplication).set('trust proxy', 1);
  app.use(helmet());
  app.enableCors({ origin: cfg.corsOrigins.length ? cfg.corsOrigins : false });
  app.setGlobalPrefix(API_PREFIX, { exclude: ['health'] });
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();
  return app;
}

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Roam API')
    .setDescription(
      'Backend for the Roam iOS tour app. All money is stored in AZN; pass `?currency=EUR|USD` (or set it in the profile) to get display prices. ' +
        'Guests can browse the catalog and use the AI planner (daily limit); favorites, saved plans and tour requests need a Bearer token.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addServer('http://localhost:3000')
    .build();
  return SwaggerModule.createDocument(app, config);
}
