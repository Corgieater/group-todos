import { IsEmail, IsNotEmpty, IsString, IsOptional } from 'class-validator';

export class AuthSignupDto {
  @IsNotEmpty()
  @IsString()
  name: string;
  @IsEmail()
  @IsNotEmpty()
  email: string;
  @IsNotEmpty()
  @IsString()
  password: string;
  @IsOptional()
  @IsString()
  inviteCode?: string; /* this is for users that might got invited to some group*/
}

export class AuthSigninDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
  @IsNotEmpty()
  @IsString()
  password: string;
}

export class AuthUpdatePasswordDto {
  @IsNotEmpty()
  @IsString()
  oldPassword: string;
  @IsNotEmpty()
  @IsString()
  newPassword: string;
}

export class AuthForgotPasswordDto {
  @IsNotEmpty()
  @IsEmail()
  email: string;
}

export class AuthResetPasswordDto {
  @IsNotEmpty()
  newPassword: string;

  @IsNotEmpty()
  confirmPassword: string;
}
