import {
  ConflictException,
  UnauthorizedException,
  Injectable,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import * as argon from 'argon2';
import crypto from 'crypto';
import { User as UserModel } from '@prisma/client';

import { AuthSignupDto } from './dto/auth.dto';

import { JwtService } from '@nestjs/jwt';
import { UsersService } from 'src/users/users.service';
import { MailService } from 'src/mail/mail.service';
import { AuthUpdatePasswordPayload } from './types/auth';
import { PrismaService } from 'src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  constructor(
    private config: ConfigService,
    private usersService: UsersService,
    private prismaService: PrismaService,
    private jwtService: JwtService,
    private mailService: MailService,
  ) {}
  async signup(dto: AuthSignupDto): Promise<void> {
    const existUser = await this.usersService.findByEmail(dto.email);
    if (existUser) {
      throw new ConflictException();
    }

    const createUserInput = {
      name: dto.name,
      email: dto.email,
      hash: await this.hash(dto.password),
    };
    await this.usersService.create(createUserInput);
  }

  async signin(
    email: string,
    password: string,
  ): Promise<{ accessToken: string }> {
    const userInfo: UserModel =
      await this.usersService.findByEmailOrThrow(email);
    if (!(await this.verify(userInfo.hash, password))) {
      throw new UnauthorizedException();
    }

    return {
      accessToken: await this.jwtService.signAsync({
        sub: userInfo.id,
        userName: userInfo.name,
        email: userInfo.email,
      }),
    };
  }

  async hash(
    raw: string,
    options?: argon.Options & { type?: number },
  ): Promise<string> {
    return await argon.hash(raw, options);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    return await argon.verify(hash, password);
  }

  generateUrlFriendlySecret(bytes: number): string {
    return crypto.randomBytes(bytes).toString('base64url');
  }

  async changePassword(payload: AuthUpdatePasswordPayload): Promise<void> {
    const user = await this.usersService.findByIdOrThrow(payload.userId);
    if (!(await this.verify(user.hash, payload.oldPassword))) {
      throw new ForbiddenException('Old password is incorrect');
    }
    if (await this.verify(user.hash, payload.newPassword)) {
      throw new BadRequestException('Please use a new password');
    }

    const newHash = await this.hash(payload.newPassword);
    await this.usersService.update({
      id: payload.userId,
      hash: newHash,
    });
  }

  async resetPassword(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);

    if (!user) return;

    const rawToken = this.generateUrlFriendlySecret(32);
    const hashedToken = await this.hash(rawToken, { type: argon.argon2id });
    const row = await this.prismaService.resetPasswordToken.create({
      data: {
        userId: user.id,
        tokenHash: hashedToken,
      },
      select: { id: true },
    });

    const link = `${this.config.get<string>('BASE_URL')}api/auth/reset-password?id=${row.id}&token=${rawToken}`;
    await this.mailService.sendMail(user, link);
  }
}
