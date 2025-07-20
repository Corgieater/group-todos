import { IsEmail, IsNotEmpty } from 'class-validator';

export class AuthSignupDto {
  @IsNotEmpty()
  name: string;
  @IsEmail()
  @IsNotEmpty()
  email: string;
  @IsNotEmpty()
  password: string;
  group?: number; /* this is for users that might got invited to some group*/
}

export class AuthSigninDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
  @IsNotEmpty()
  password: string;
}
