import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { buildOpenApi, configureApp } from '../setup';

/** Writes openapi.json (usable with Apple's swift-openapi-generator). Needs a reachable DATABASE_URL. */
async function main() {
  process.env.DISABLE_CRON = 'true';
  process.env.RATES_DISABLE_FETCH = 'true';
  const app = configureApp(await NestFactory.create(AppModule, { logger: ['error'] }));
  await app.init();
  const out = path.resolve(process.argv[2] ?? 'openapi.json');
  writeFileSync(out, JSON.stringify(buildOpenApi(app), null, 2));
  await app.close();
  console.log(`OpenAPI written to ${out}`);
}

void main();
