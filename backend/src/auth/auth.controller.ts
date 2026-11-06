import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AppleAuthDto,
  AuthResponseDto,
  ForgotPasswordDto,
  GoogleAuthDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
} from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('Auth')
@Controller('auth')
@Throttle({ default: { limit: Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? 20), ttl: 60_000 } })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Create account (Full name, Email, Password, accept Terms)' })
  @ApiOkResponse({ type: AuthResponseDto })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in with email + password' })
  @ApiOkResponse({ type: AuthResponseDto })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('google')
  @HttpCode(200)
  @ApiOperation({ summary: 'Continue with Google' })
  @ApiOkResponse({ type: AuthResponseDto })
  google(@Body() dto: GoogleAuthDto) {
    return this.auth.google(dto.idToken);
  }

  @Post('apple')
  @HttpCode(200)
  @ApiOperation({ summary: 'Continue with Apple' })
  @ApiOkResponse({ type: AuthResponseDto })
  apple(@Body() dto: AppleAuthDto) {
    return this.auth.apple(dto);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair (rotating)' })
  @ApiOkResponse({ type: AuthResponseDto })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @Post('forgot-password')
  @HttpCode(204)
  @Throttle({ default: { limit: Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? 5), ttl: 60_000 } })
  @ApiOperation({ summary: '“Forgot password?” — emails a reset link (always 204)' })
  async forgot(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Set a new password using the emailed token' })
  async reset(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.newPassword);
  }
}
