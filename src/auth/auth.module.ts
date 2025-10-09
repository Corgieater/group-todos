import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthPageController } from './auth.page.controller';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from 'src/users/users.module';
import { AccessTokenStrategy } from './strategies/access-token.strategy';
import { MailModule } from 'src/mail/mail.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ResetPasswordTokenStrategy } from './strategies/reset-password-token.strategy';

@Module({
  imports: [
    PassportModule,
    UsersModule,
    PrismaModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // this default is for signin token
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.getOrThrow<number>('TOKEN_EXPIRE_TIME'),
        },
      }),
    }),
    MailModule,
  ],
  controllers: [AuthController, AuthPageController],
  providers: [AuthService, AccessTokenStrategy, ResetPasswordTokenStrategy],
  exports: [AuthService],
})
export class AuthModule {}
