import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsOptional,
  registerDecorator,
  ValidationArguments,
} from 'class-validator';

function IsIanaTimeZone() {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isIanaTimeZone',
      target: object.constructor,
      propertyName,
      validator: {
        validate(value: any) {
          if (typeof value !== 'string') return false;
          const tzList = Intl.supportedValuesOf?.('timeZone') ?? [];
          return tzList.includes(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid IANA time zone (e.g. "Asia/Taipei")`;
        },
      },
    });
  };
}

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

  @IsString()
  @IsIanaTimeZone()
  timeZone: string;

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

  @IsOptional()
  @IsString()
  _csrf_token?: string; // 只為了通過 ValidationPipe，實際不使用
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
