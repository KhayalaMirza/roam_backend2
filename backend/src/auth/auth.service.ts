import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { AccessTokenPayload } from '../common/auth';
import { fieldError } from '../common/validation';
import { APP_CONFIG, AppConfig } from '../config/env';
import { DB, Db } from '../db/db.module';
import { passwordResets, refreshTokens, User, users } from '../db/schema';
import { MailService } from '../notifications/notifications.module';
import { AppleAuthDto, AuthResponseDto, LoginDto, RegisterDto } from './auth.dto';
import { SocialIdentity, SocialVerifier } from './social-verifier.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function initials(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase() || '?';
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly jwt: JwtService,
    private readonly social: SocialVerifier,
    private readonly mail: MailService,
  ) {}

  hashPassword(pw: string) {
    return bcrypt.hash(pw, 11);
  }
  verifyPassword(pw: string, hash: string) {
    return bcrypt.compare(pw, hash);
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const [u] = await this.db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`).limit(1);
    return u;
  }

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    if (await this.findByEmail(dto.email)) throw fieldError('email', 'An account with this email already exists.', 409);
    const [u] = await this.db
      .insert(users)
      .values({
        fullName: dto.fullName,
        email: dto.email,
        passwordHash: await this.hashPassword(dto.password),
        termsAcceptedAt: new Date(),
      })
      .returning();
    return this.issue(u, true);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const u = await this.findByEmail(dto.email);
    // Same message for unknown email and wrong password (no account enumeration).
    if (!u || !u.passwordHash || !(await this.verifyPassword(dto.password, u.passwordHash))) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'InvalidCredentials',
        message: 'Email or password is incorrect.',
        fields: { password: 'Email or password is incorrect.' },
      });
    }
    return this.issue(u, false);
  }

  async google(idToken: string) {
    const id = await this.social.google(idToken);
    return this.socialLogin('google', id, id.name);
  }

  async apple(dto: AppleAuthDto) {
    const id = await this.social.apple(dto.identityToken, dto.nonce);
    return this.socialLogin('apple', id, dto.fullName ?? null);
  }

  private async socialLogin(provider: 'google' | 'apple', id: SocialIdentity, name: string | null): Promise<AuthResponseDto> {
    const col = provider === 'google' ? users.googleSub : users.appleSub;
    const [existing] = await this.db.select().from(users).where(eq(col, id.sub)).limit(1);
    if (existing) return this.issue(existing, false);

    // Link to an existing email account only when the provider vouches for the email.
    if (id.email && id.emailVerified) {
      const byEmail = await this.findByEmail(id.email);
      if (byEmail) {
        const [linked] = await this.db
          .update(users)
          .set(provider === 'google' ? { googleSub: id.sub, updatedAt: new Date() } : { appleSub: id.sub, updatedAt: new Date() })
          .where(eq(users.id, byEmail.id))
          .returning();
        return this.issue(linked, false);
      }
    }
    if (!id.email) throw new ConflictException('Your account did not share an email address. Please sign up with email.');
    const fallbackName = name?.trim() || id.email.split('@')[0];
    const [u] = await this.db
      .insert(users)
      .values({
        fullName: fallbackName,
        email: id.email,
        googleSub: provider === 'google' ? id.sub : null,
        appleSub: provider === 'apple' ? id.sub : null,
        termsAcceptedAt: new Date(),
      })
      .returning();
    return this.issue(u, true);
  }

  async issue(u: User, isNewUser: boolean): Promise<AuthResponseDto> {
    const payload: AccessTokenPayload = { sub: u.id, role: u.role, typ: 'access' };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: this.cfg.jwt.accessTtlSeconds });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.db.insert(refreshTokens).values({
      userId: u.id,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + this.cfg.jwt.refreshTtlDays * 86400_000),
    });
    return {
      accessToken,
      refreshToken,
      expiresIn: this.cfg.jwt.accessTtlSeconds,
      isNewUser,
      user: { id: u.id, fullName: u.fullName, email: u.email, initials: initials(u.fullName) },
    };
  }

  /** Rotating refresh tokens with reuse detection: presenting a revoked token kills every session of that user. */
  async refresh(token: string): Promise<AuthResponseDto> {
    const hash = sha256(token);
    const [row] = await this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hash)).limit(1);
    const invalid = new UnauthorizedException({ statusCode: 401, error: 'RefreshInvalid', message: 'Session expired. Please log in again.' });
    if (!row) throw invalid;
    if (row.revokedAt) {
      await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt)));
      throw invalid;
    }
    if (row.expiresAt < new Date()) throw invalid;
    const [u] = await this.db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    if (!u) throw invalid;
    // Revoke-then-issue. If two refreshes race, only the first passes the `revoked_at IS NULL` check.
    const revoked = await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    if (!revoked.length) throw invalid;
    return this.issue(u, false);
  }

  async logout(token: string) {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.tokenHash, sha256(token)), isNull(refreshTokens.revokedAt)));
  }

  async revokeAll(userId: string) {
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  /** Always answers 204 to avoid revealing which emails exist. */
  async forgotPassword(email: string) {
    const u = await this.findByEmail(email);
    if (!u) return;
    const token = randomBytes(32).toString('base64url');
    await this.db.insert(passwordResets).values({ userId: u.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600_000) });
    const link = `${this.cfg.mail.resetLinkBase}?token=${token}`;
    await this.mail.send(
      u.email,
      'Reset your Roam password',
      `Hi ${u.fullName.split(' ')[0]},\n\nTap the link below on your iPhone to choose a new password. It expires in 1 hour.\n\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
    );
  }

  async resetPassword(token: string, newPassword: string) {
    const [row] = await this.db
      .select()
      .from(passwordResets)
      .where(and(eq(passwordResets.tokenHash, sha256(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())))
      .limit(1);
    if (!row) throw fieldError('token', 'This reset link is invalid or has expired.');
    await this.db.transaction(async (tx) => {
      await tx.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, row.id));
      await tx.update(users).set({ passwordHash: await this.hashPassword(newPassword), updatedAt: new Date() }).where(eq(users.id, row.userId));
    });
    await this.revokeAll(row.userId);
  }
}
