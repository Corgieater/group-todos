import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthPageController } from './auth.page.controller';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from 'src/users/users.module';
import { AccessTokenStrategy } from './strategies/access-token.strategy';
import { MailModule } from 'src/mail/mail.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ResetPasswordTokenStrategy } from './strategies/reset-password-token.strategy';
import { SecurityModule } from 'src/security/security.module';

@Module({
  imports: [
    PassportModule,
    SecurityModule,
    UsersModule,
    PrismaModule,
    MailModule,
  ],
  controllers: [AuthController, AuthPageController],
  providers: [AuthService, AccessTokenStrategy, ResetPasswordTokenStrategy],
  exports: [AuthService],
})
export class AuthModule {}
