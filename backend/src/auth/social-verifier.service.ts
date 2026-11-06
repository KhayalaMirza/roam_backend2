import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';
import { APP_CONFIG, AppConfig } from '../config/env';

export type SocialIdentity = { sub: string; email: string | null; emailVerified: boolean; name: string | null };

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

const invalid = () => new UnauthorizedException({ statusCode: 401, error: 'SocialTokenInvalid', message: 'Could not verify sign-in. Please try again.' });

/** Verifies Google / Apple identity tokens against their published JWKS. Overridable in tests. */
@Injectable()
export class SocialVerifier {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async google(idToken: string): Promise<SocialIdentity> {
    if (!this.cfg.google.clientIds.length) throw new UnauthorizedException('Google sign-in is not configured (GOOGLE_CLIENT_IDS).');
    let p: JWTPayload & { email?: string; email_verified?: boolean | string; name?: string };
    try {
      ({ payload: p } = await jwtVerify(idToken, GOOGLE_JWKS, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: this.cfg.google.clientIds,
      }));
    } catch {
      throw invalid();
    }
    if (!p.sub) throw invalid();
    return {
      sub: p.sub,
      email: p.email ?? null,
      emailVerified: p.email_verified === true || p.email_verified === 'true',
      name: p.name ?? null,
    };
  }

  async apple(identityToken: string, rawNonce?: string): Promise<SocialIdentity> {
    if (!this.cfg.apple.audiences.length) throw new UnauthorizedException('Apple sign-in is not configured (APPLE_AUDIENCES).');
    let p: JWTPayload & { email?: string; email_verified?: boolean | string; nonce?: string };
    try {
      ({ payload: p } = await jwtVerify(identityToken, APPLE_JWKS, {
        issuer: 'https://appleid.apple.com',
        audience: this.cfg.apple.audiences,
      }));
    } catch {
      throw invalid();
    }
    if (!p.sub) throw invalid();
    if (rawNonce) {
      const hashed = createHash('sha256').update(rawNonce).digest('hex');
      if (p.nonce !== hashed && p.nonce !== rawNonce) throw invalid();
    }
    return {
      sub: p.sub,
      email: p.email ?? null,
      emailVerified: p.email_verified === true || p.email_verified === 'true',
      name: null,
    };
  }
}
