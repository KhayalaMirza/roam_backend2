/**
 * Centralised, validated environment configuration.
 * Everything optional has a safe dev default; production-critical values are checked in assertProductionConfig().
 */
export type AppConfig = ReturnType<typeof loadConfig>;

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const int = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    port: int(env.PORT, 3000),
    databaseUrl: env.DATABASE_URL ?? 'postgres://roam:roam@localhost:5432/roam',
    corsOrigins: list(env.CORS_ORIGINS),
    jwt: {
      secret: env.JWT_SECRET ?? 'dev-only-change-me-please-32-chars-min',
      accessTtlSeconds: int(env.JWT_ACCESS_TTL_SECONDS, 15 * 60),
      refreshTtlDays: int(env.JWT_REFRESH_TTL_DAYS, 30),
    },
    google: {
      /** OAuth client IDs whose ID tokens we accept (iOS client ID from Google Cloud console). */
      clientIds: list(env.GOOGLE_CLIENT_IDS),
    },
    apple: {
      /** Bundle ID(s) / Services ID(s) that appear as `aud` in Apple identity tokens. */
      audiences: list(env.APPLE_AUDIENCES ?? env.APNS_BUNDLE_ID),
    },
    apns: {
      keyId: env.APNS_KEY_ID ?? '',
      teamId: env.APNS_TEAM_ID ?? '',
      bundleId: env.APNS_BUNDLE_ID ?? '',
      /** Contents of the .p8 key. `\n` sequences are accepted. */
      privateKey: (env.APNS_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
    },
    ai: {
      anthropicApiKey: env.ANTHROPIC_API_KEY ?? '',
      model: env.AI_MODEL ?? 'claude-sonnet-5-5',
      guestDailyLimit: int(env.AI_GUEST_DAILY_LIMIT, 10),
      userDailyLimit: int(env.AI_USER_DAILY_LIMIT, 100),
    },
    rates: {
      /** CBAR official daily rates (XML). DD.MM.YYYY is substituted. */
      cbarUrlTemplate: env.CBAR_URL_TEMPLATE ?? 'https://www.cbar.az/currencies/{date}.xml',
      fallbackAznPerUsd: Number(env.FALLBACK_AZN_PER_USD ?? 1.7),
      fallbackAznPerEur: Number(env.FALLBACK_AZN_PER_EUR ?? 1.98),
      disableFetch: env.RATES_DISABLE_FETCH === 'true',
    },
    operator: {
      webhookUrl: env.OPERATOR_WEBHOOK_URL ?? '',
      email: env.OPERATOR_EMAIL ?? '',
    },
    mail: {
      webhookUrl: env.MAIL_WEBHOOK_URL ?? '',
      from: env.MAIL_FROM ?? 'Roam <no-reply@roam.app>',
      resetLinkBase: env.PASSWORD_RESET_LINK_BASE ?? 'roam://reset-password',
    },
    admin: {
      email: env.ADMIN_EMAIL ?? '',
      password: env.ADMIN_PASSWORD ?? '',
    },
    disableCron: env.DISABLE_CRON === 'true',
  };
}

export function assertProductionConfig(cfg: AppConfig) {
  if (cfg.nodeEnv !== 'production') return;
  const problems: string[] = [];
  if (cfg.jwt.secret.startsWith('dev-only') || cfg.jwt.secret.length < 32) problems.push('JWT_SECRET must be set (>= 32 chars)');
  if (problems.length) throw new Error(`Invalid production config:\n- ${problems.join('\n- ')}`);
}

export const APP_CONFIG = Symbol('APP_CONFIG');
