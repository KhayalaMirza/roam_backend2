import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SocialIdentity, SocialVerifier } from '../src/auth/social-verifier.service';
import { runMigrations } from '../src/db/migrate';
import { seed } from '../src/db/seed';
import { MailService, PushService } from '../src/notifications/notifications.module';
import { configureApp } from '../src/setup';

export class FakeSocialVerifier {
  google = jest.fn(async (token: string): Promise<SocialIdentity> => JSON.parse(token));
  apple = jest.fn(async (token: string): Promise<SocialIdentity> => JSON.parse(token));
}

export type TestCtx = {
  app: INestApplication;
  http: () => ReturnType<typeof request>;
  mail: { send: jest.Mock };
  push: { sendToUser: jest.Mock };
};

export async function resetDatabase() {
  const url = process.env.DATABASE_URL!;
  const pool = new Pool({ connectionString: url, max: 1 });
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
  await pool.end();
  await runMigrations(url);
  await seed(url, { adminEmail: 'admin@roam.app', adminPassword: 'admin12345', log: false });
}

export async function createTestApp(): Promise<TestCtx> {
  const mail = { send: jest.fn(async () => undefined) };
  const push = { sendToUser: jest.fn(async () => undefined) };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SocialVerifier)
    .useClass(FakeSocialVerifier)
    .overrideProvider(MailService)
    .useValue(mail)
    .overrideProvider(PushService)
    .useValue(push)
    .compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: ['error'] }));
  await app.init();
  return { app, http: () => request(app.getHttpServer()), mail, push };
}

export async function registerUser(ctx: TestCtx, email: string, fullName = 'Yusif Nasibli') {
  const res = await ctx.http().post('/v1/auth/register').send({ fullName, email, password: 'password123', acceptTerms: true }).expect(201);
  return res.body as { accessToken: string; refreshToken: string; user: { id: string } };
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
