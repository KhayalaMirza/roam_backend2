import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthResolver, JwtAuthGuard, OptionalAuthGuard, RolesGuard } from '../common/auth';
import { APP_CONFIG, AppConfig } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SocialVerifier } from './social-verifier.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) => ({ secret: cfg.jwt.secret, signOptions: { algorithm: 'HS256' }, verifyOptions: { algorithms: ['HS256'] } }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SocialVerifier, AuthResolver, JwtAuthGuard, OptionalAuthGuard, RolesGuard],
  exports: [AuthService, AuthResolver, JwtAuthGuard, OptionalAuthGuard, RolesGuard, JwtModule],
})
export class AuthModule {}
