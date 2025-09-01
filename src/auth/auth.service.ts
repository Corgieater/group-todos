import { Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import * as argon from 'argon2';
import crypto from 'crypto';
import { User as UserModel } from '@prisma/client';

import { AuthSignupDto } from './dto/auth.dto';

import { JwtService } from '@nestjs/jwt';
import { UsersService } from 'src/users/users.service';
import { MailService } from 'src/mail/mail.service';
import {
  NormalAccessTokenPayload,
  ResetAccessTokenPayload,
  AuthUpdatePasswordPayload,
} from './types/auth';
import { PrismaService } from 'src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

import { AuthErrors } from 'src/errors';
import { UsersErrors } from 'src/errors';

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
      throw new AuthErrors.CredentialDuplicatedError();
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
    let payload: NormalAccessTokenPayload;
    const user: UserModel | null = await this.usersService.findByEmail(email);
    if (!user) {
      throw UsersErrors.UserNotFoundError.byEmail(email);
    }
    // TODO
    // is it possible to do 'forgot password <a> link </a> here?
    if (!(await this.verify(user.hash, password))) {
      throw AuthErrors.InvalidCredentialError.password();
    }
    payload = {
      tokenUse: 'access',
      sub: user.id,
      userName: user.name,
      email: user.email,
    };
    return {
      accessToken: await this.jwtService.signAsync(payload),
    };
  }

  async hash(
    raw: string,
    options?: argon.Options & { type?: number },
  ): Promise<string> {
    return await argon.hash(raw, options);
  }

  async verify(hash: string, origin: string): Promise<boolean> {
    return await argon.verify(hash, origin);
  }

  generateUrlFriendlySecret(bytes: number): string {
    return crypto.randomBytes(bytes).toString('base64url');
  }

  async changePassword(payload: AuthUpdatePasswordPayload): Promise<void> {
    const user = await this.usersService.findById(payload.userId);

    if (!user) {
      throw UsersErrors.UserNotFoundError.byId(payload.userId);
    }

    if (!(await this.verify(user.hash, payload.oldPassword))) {
      throw new AuthErrors.InvalidOldPasswordError();
    }

    if (await this.verify(user.hash, payload.newPassword)) {
      throw new AuthErrors.PasswordReuseError();
    }

    const newHash = await this.hash(payload.newPassword);

    await this.prismaService.$transaction(async (tx) => {
      await this.usersService.updatePasswordHash(payload.userId, newHash, tx);
    });
  }

  async resetPassword(email: string): Promise<void> {
    /**
     * Initiates the password reset flow for a given email address.
     *
     * This method is intentionally silent: if no user account is found for the
     * provided email, the function simply resolves without error. This prevents
     * leaking which emails are registered (credential enumeration).
     *
     * @param email User email address
     * @returns Promise<void> – resolves after creating a reset token and sending
     *          an email if a matching user exists; resolves silently otherwise.
     * @throws Prisma errors if database insert fails; Mailer errors if sending fails.
     */
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

    const link = `${this.config.get<string>('BASE_URL')}api/auth/verify-reset-token/${row.id}/${rawToken}`;
    await this.mailService.sendMail(user, link);
  }

  async verifyResetToken(
    id: number,
    token: string,
  ): Promise<{ accessToken: string }> {
    const result = await this.prismaService.resetPasswordToken.findFirst({
      where: { id, usedAt: null, expiredAt: { gt: new Date() } },
      select: {
        id: true,
        tokenHash: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
    if (!result) {
      throw AuthErrors.InvalidTokenError.reset();
    }

    const isMatched = await this.verify(result['tokenHash'], token);
    if (!isMatched) {
      throw AuthErrors.InvalidTokenError.verify();
    }

    const accessTokenPayload: ResetAccessTokenPayload = {
      tokenUse: 'resetPassword',
      sub: result.user.id,
      userName: result.user.name,
      email: result.user.email,
      tokenId: result.id,
    };

    return {
      accessToken: await this.jwtService.signAsync(accessTokenPayload),
    };
  }

  async confirmResetPassword(
    tokenId: number,
    userId: number,
    newPassword: string,
    confirmPassword: string,
  ) {
    const user: UserModel | null = await this.usersService.findById(userId);
    if (!user) {
      throw UsersErrors.UserNotFoundError.byId(userId);
    }

    if (await this.verify(user.hash, newPassword)) {
      throw new AuthErrors.PasswordReuseError();
    }

    if (newPassword !== confirmPassword) {
      throw new AuthErrors.PasswordConfirmationMismatchError();
    }

    const newHash = await this.hash(newPassword);
    const now = new Date();

    await this.prismaService.$transaction(
      async (tx) => {
        // Use updateMany, since we need to make sure there is no duplicated token
        const { count } = await tx.resetPasswordToken.updateMany({
          where: {
            id: tokenId,
            userId,
            usedAt: null,
            expiredAt: { gt: now },
          },
          data: { usedAt: now },
        });

        if (count !== 1) {
          throw AuthErrors.InvalidTokenError.reset();
        }

        await this.usersService.updatePasswordHash(userId, newHash, tx);

        // delete unused token, save used token for audit/traceability
        await tx.resetPasswordToken.deleteMany({
          where: { userId, usedAt: null },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }
}
