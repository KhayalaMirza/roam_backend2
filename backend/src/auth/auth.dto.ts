import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const lower = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

export class RegisterDto {
  @ApiProperty({ example: 'Yusif Nasibli' })
  @trim()
  @IsString()
  @IsNotEmpty({ message: 'Enter your full name.' })
  @MaxLength(80)
  fullName: string;

  @ApiProperty({ example: 'yusif@example.com' })
  @lower()
  @IsEmail({}, { message: 'Enter a valid email address.' })
  email: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(128)
  password: string;

  @ApiProperty({ description: '“I agree to the Terms and Privacy Policy” — must be true' })
  @IsBoolean()
  @Equals(true, { message: 'Please accept the Terms and Privacy Policy.' })
  acceptTerms: boolean;
}

export class LoginDto {
  @ApiProperty()
  @lower()
  @IsEmail({}, { message: 'Enter a valid email address.' })
  email: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'Enter your password.' })
  password: string;
}

export class GoogleAuthDto {
  @ApiProperty({ description: 'ID token from GoogleSignIn-iOS (GIDGoogleUser.idToken.tokenString)' })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}

export class AppleAuthDto {
  @ApiProperty({ description: 'ASAuthorizationAppleIDCredential.identityToken as UTF-8 string' })
  @IsString()
  @IsNotEmpty()
  identityToken: string;

  @ApiPropertyOptional({ description: 'Raw nonce used for the request (server checks sha256(nonce) against the token).' })
  @IsOptional()
  @IsString()
  nonce?: string;

  @ApiPropertyOptional({ description: 'Apple only returns the name on the very first sign-in — forward it.' })
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(80)
  fullName?: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @lower()
  @IsEmail({}, { message: 'Enter a valid email address.' })
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(128)
  newPassword: string;
}

export class AuthUserDto {
  @ApiProperty() id: string;
  @ApiProperty() fullName: string;
  @ApiProperty() email: string;
  @ApiProperty({ example: 'YN' }) initials: string;
}

export class AuthResponseDto {
  @ApiProperty() accessToken: string;
  @ApiProperty() refreshToken: string;
  @ApiProperty({ description: 'Access token lifetime in seconds' }) expiresIn: number;
  @ApiProperty() isNewUser: boolean;
  @ApiProperty({ type: AuthUserDto }) user: AuthUserDto;
}
