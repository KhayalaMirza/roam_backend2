import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import http2 from 'node:http2';
import { eq, inArray } from 'drizzle-orm';
import { importPKCS8, SignJWT } from 'jose';
import { APP_CONFIG, AppConfig } from '../config/env';
import { DB, Db } from '../db/db.module';
import { devices, users } from '../db/schema';

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
}

/**
 * Transactional email. Plug in any provider by pointing MAIL_WEBHOOK_URL at a small relay
 * (e.g. a Resend/SES/Postmark function). Without it, mails are logged — fine for development.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async send(to: string, subject: string, text: string) {
    if (!this.cfg.mail.webhookUrl) {
      this.log.log(`[mail:dev] to=${to} subject="${subject}"\n${text}`);
      return;
    }
    await postJson(this.cfg.mail.webhookUrl, { from: this.cfg.mail.from, to, subject, text }).catch((e) =>
      this.log.error(`Mail send failed: ${e}`),
    );
  }
}

export type OperatorRequestEvent = {
  event: 'request.created' | 'request.cancelled';
  request: {
    code: string;
    tourId: string;
    tourTitle: string;
    startDate: string | null;
    endDate: string | null;
    flexible: boolean;
    adults: number;
    children: number;
    contactName: string;
    contactPhone: string;
    contactEmail: string;
    note: string | null;
    /** Always present — the operator works in AZN (PDF §8). */
    totalAZN: number;
    displayCurrency: string;
    displayTotal: number;
    createdAt: string;
  };
};

/**
 * Delivers new tour requests to operators. Open question in PDF §11 (admin panel / email / CRM):
 * requests are always visible in the admin API; additionally they are POSTed to OPERATOR_WEBHOOK_URL
 * (CRM, Slack, Zapier…) and emailed to OPERATOR_EMAIL when configured.
 */
@Injectable()
export class OperatorNotifier {
  private readonly log = new Logger(OperatorNotifier.name);
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly mail: MailService,
  ) {}

  async notify(e: OperatorRequestEvent) {
    const r = e.request;
    const tasks: Promise<unknown>[] = [];
    if (this.cfg.operator.webhookUrl) tasks.push(postJson(this.cfg.operator.webhookUrl, e));
    if (this.cfg.operator.email) {
      const dates = r.flexible ? 'Flexible' : `${r.startDate} → ${r.endDate}`;
      tasks.push(
        this.mail.send(
          this.cfg.operator.email,
          `[Roam] ${e.event === 'request.created' ? 'New request' : 'Request cancelled'} ${r.code} — ${r.tourTitle}`,
          [
            `Request: ${r.code}`,
            `Tour: ${r.tourTitle} (${r.tourId})`,
            `Dates: ${dates}`,
            `Travelers: ${r.adults} adults, ${r.children} children`,
            `Total: ${r.totalAZN} AZN` + (r.displayCurrency !== 'AZN' ? ` (customer saw ${r.displayTotal} ${r.displayCurrency})` : ''),
            `Contact: ${r.contactName}, ${r.contactPhone}, ${r.contactEmail}`,
            r.note ? `Note: ${r.note}` : '',
          ].join('\n'),
        ),
      );
    }
    if (!tasks.length) this.log.log(`[operator:dev] ${e.event} ${r.code} ${r.tourTitle} total=${r.totalAZN} AZN`);
    const results = await Promise.allSettled(tasks);
    results.forEach((x) => x.status === 'rejected' && this.log.error(`Operator notification failed: ${x.reason}`));
  }
}

export type PushPayload = { title: string; body: string; data?: Record<string, unknown> };

/** Minimal APNs HTTP/2 client using token-based (.p8) auth. */
@Injectable()
export class PushService {
  private readonly log = new Logger(PushService.name);
  private jwt: { token: string; issuedAt: number } | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(DB) private readonly db: Db,
  ) {}

  get configured() {
    const a = this.cfg.apns;
    return Boolean(a.keyId && a.teamId && a.bundleId && a.privateKey);
  }

  private async providerToken() {
    // APNs tokens are valid for 1h; refresh every 50 min.
    if (this.jwt && Date.now() - this.jwt.issuedAt < 50 * 60 * 1000) return this.jwt.token;
    const key = await importPKCS8(this.cfg.apns.privateKey, 'ES256');
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: this.cfg.apns.keyId })
      .setIssuer(this.cfg.apns.teamId)
      .setIssuedAt()
      .sign(key);
    this.jwt = { token, issuedAt: Date.now() };
    return token;
  }

  async sendToUser(userId: string, payload: PushPayload) {
    const [u] = await this.db.select({ enabled: users.notificationsEnabled }).from(users).where(eq(users.id, userId));
    if (!u?.enabled) return;
    const rows = await this.db.select().from(devices).where(eq(devices.userId, userId));
    if (!rows.length) return;
    if (!this.configured) {
      this.log.log(`[push:dev] user=${userId} devices=${rows.length} "${payload.title}: ${payload.body}"`);
      return;
    }
    const dead: string[] = [];
    await Promise.all(
      rows.map(async (d) => {
        try {
          const status = await this.sendOne(d.apnsToken, d.environment === 'sandbox', payload);
          if (status === 410 || status === 400) dead.push(d.apnsToken);
        } catch (e) {
          this.log.warn(`APNs send failed: ${e}`);
        }
      }),
    );
    if (dead.length) await this.db.delete(devices).where(inArray(devices.apnsToken, dead));
  }

  private async sendOne(deviceToken: string, sandbox: boolean, p: PushPayload): Promise<number> {
    const host = sandbox ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
    const token = await this.providerToken();
    const body = JSON.stringify({ aps: { alert: { title: p.title, body: p.body }, sound: 'default' }, ...(p.data ?? {}) });
    return new Promise((resolve, reject) => {
      const client = http2.connect(host);
      client.on('error', reject);
      const req = client.request({
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        authorization: `bearer ${token}`,
        'apns-topic': this.cfg.apns.bundleId,
        'apns-push-type': 'alert',
        'content-type': 'application/json',
      });
      let status = 0;
      req.on('response', (h) => (status = Number(h[':status'])));
      req.on('data', () => undefined);
      req.on('end', () => {
        client.close();
        resolve(status);
      });
      req.on('error', (e) => {
        client.close();
        reject(e);
      });
      req.end(body);
    });
  }
}

@Global()
@Module({ providers: [MailService, OperatorNotifier, PushService], exports: [MailService, OperatorNotifier, PushService] })
export class NotificationsModule {}
