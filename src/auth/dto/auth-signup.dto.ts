import { IsEmail, IsNotEmpty } from 'class-validator';

export class AuthSignupDto {
  @IsNotEmpty()
  userName: string;
  @IsEmail()
  email: string;
  @IsNotEmpty()
  password: string;
  group?: number; /* this is for users that might got invited to some group*/
}
