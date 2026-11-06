import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { DB, Db } from '../db/db.module';
import { Currency, users } from '../db/schema';

export type AuthUser = {
  id: string;
  role: 'user' | 'operator' | 'admin';
  email: string;
  fullName: string;
  phone: string | null;
  currency: Currency;
};

export type AccessTokenPayload = { sub: string; role: AuthUser['role']; typ: 'access' };

type ReqWithUser = Request & { user?: AuthUser };

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const [scheme, token] = h.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

@Injectable()
export class AuthResolver {
  constructor(
    private readonly jwt: JwtService,
    @Inject(DB) private readonly db: Db,
  ) {}

  async resolve(req: ReqWithUser): Promise<AuthUser | null> {
    if (req.user) return req.user;
    const token = bearer(req);
    if (!token) return null;
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException({ statusCode: 401, error: 'TokenInvalid', message: 'Session expired. Please log in again.' });
    }
    if (payload.typ !== 'access') throw new UnauthorizedException();
    const [u] = await this.db
      .select({ id: users.id, role: users.role, email: users.email, fullName: users.fullName, phone: users.phone, currency: users.currency })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);
    if (!u) throw new UnauthorizedException({ statusCode: 401, error: 'TokenInvalid', message: 'Account not found.' });
    req.user = u;
    return u;
  }
}

/** Requires a valid access token. Guests get 401 with error "LoginRequired" so the app can show the login sheet (PDF §3). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly resolver: AuthResolver) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<ReqWithUser>();
    const user = await this.resolver.resolve(req);
    if (!user)
      throw new UnauthorizedException({ statusCode: 401, error: 'LoginRequired', message: 'Log in to continue.' });
    return true;
  }
}

/** Attaches the user if a token is present; guests pass through. */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly resolver: AuthResolver) {}
  async canActivate(ctx: ExecutionContext) {
    await this.resolver.resolve(ctx.switchToHttp().getRequest<ReqWithUser>());
    return true;
  }
}

export const ROLES_KEY = 'roles';
export const Roles = (...roles: AuthUser['role'][]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: AuthResolver,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<AuthUser['role'][]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    const user = await this.resolver.resolve(ctx.switchToHttp().getRequest<ReqWithUser>());
    if (!user) throw new UnauthorizedException({ statusCode: 401, error: 'LoginRequired', message: 'Log in to continue.' });
    if (roles.length && !roles.includes(user.role)) throw new ForbiddenException();
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser | null => {
  return ctx.switchToHttp().getRequest<ReqWithUser>().user ?? null;
});
