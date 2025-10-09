import { ActionTokenType, Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import * as argon from 'argon2';
import crypto, { createHmac, timingSafeEqual } from 'crypto';
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
import { addTime } from 'src/common/helpers/util';

@Injectable()
export class AuthService {
  constructor(
    private config: ConfigService,
    private usersService: UsersService,
    private prismaService: PrismaService,
    private jwtService: JwtService,
    private mailService: MailService,
  ) {}

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

  hmacToken(raw: string, secret: string): string {
    return createHmac('sha256', secret).update(raw).digest('base64url');
  }

  safeEqualB64url(aB64: string, bB64: string): boolean {
    const a = Buffer.from(aB64, 'base64url');
    const b = Buffer.from(bB64, 'base64url');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async signup(dto: AuthSignupDto): Promise<void> {
    const existUser = await this.usersService.findByEmail(dto.email);
    if (existUser) {
      throw AuthErrors.CredentialDuplicatedError.email(dto.email);
    }
    const createUserInput = {
      name: dto.name,
      email: dto.email,
      timeZone: dto.timeZone,
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
      timeZone: user.timeZone,
    };
    return {
      accessToken: await this.jwtService.signAsync(payload),
    };
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
     * Starts the password-reset flow for a given email.
     *
     * - Silently no-ops if the email is not registered (prevents credential enumeration).
     * - Generates a high-entropy URL-safe token, computes an HMAC-SHA-256 hash,
     *   and upserts an ActionToken row identified by a unique `subjectKey`
     *   (`RESET_PASSWORD:user:{userId}`) so there is at most one active reset token
     *   per user at a time.
     * - Sets a short expiration window (currently 15 minutes).
     * - After DB commit, sends the reset email containing the one-time URL
     *   `.../api/verify-reset-token/:tokenId/:rawToken`.
     *
     * Side effects:
     * - Writes/updates an ActionToken row.
     * - Sends an email to the user (out-of-transaction).
     *
     * Security notes:
     * - Only the token *hash* is stored (HMAC-SHA-256 with server secret).
     * - The function is intentionally silent for unknown emails.
     *
     * @param email - The user's email address.
     * @returns Promise<void> Resolves whether or not a user exists for the email.
     * @throws Prisma.PrismaClientKnownRequestError If the DB write/upsert fails.
     * @throws Error If configuration (e.g., TOKEN_HMAC_SECRET or BASE_URL) is missing.
     * @throws Mailer errors If sending the email fails.
     */
    const user = await this.usersService.findByEmail(email);

    if (!user) return;

    const rawToken = this.generateUrlFriendlySecret(32);
    const expiresAt = addTime(new Date(), 15, 'm');

    const serverSecret = this.config.getOrThrow<string>('TOKEN_HMAC_SECRET');
    const tokenHash = this.hmacToken(rawToken, serverSecret);

    const subjectKey = `RESET_PASSWORD:user:${user.id}`;
    const { id: tokenId } = await this.prismaService.actionToken.upsert({
      where: { subjectKey },
      update: {
        tokenHash,
        expiresAt,
        consumedAt: null,
        revokedAt: null,
      },
      create: {
        type: ActionTokenType.RESET_PASSWORD,
        subjectKey,
        tokenHash,
        userId: user.id,
        issuedById: user.id,
        expiresAt,
      },
      select: { id: true },
    });

    const baseUrl = this.config.getOrThrow<string>('BASE_URL');
    const link = new URL(
      `api/auth/verify-reset-token/${tokenId}/${rawToken}`,
      baseUrl,
    ).toString();

    await this.mailService.sendPasswordReset(user, link);
  }

  async verifyResetToken(
    id: number,
    token: string,
  ): Promise<{ accessToken: string }> {
    const NOW = new Date();
    const result = await this.prismaService.actionToken.findFirst({
      where: {
        id,
        type: ActionTokenType.RESET_PASSWORD,
        userId: { not: null },
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: NOW },
      },
      select: {
        id: true,
        tokenHash: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    if (!result || !result.user) {
      throw AuthErrors.InvalidTokenError.reset();
    }
    const serverSecret = this.config.getOrThrow<string>('TOKEN_HMAC_SECRET');
    const candidate = this.hmacToken(token, serverSecret);

    if (!this.safeEqualB64url(result.tokenHash, candidate)) {
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
      accessToken: await this.jwtService.signAsync(accessTokenPayload, {
        expiresIn: '10m',
      }),
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
    const NOW = new Date();

    await this.prismaService.$transaction(async (tx) => {
      // Use updateMany, since we need to make sure there is no duplicated token
      const { count } = await tx.actionToken.updateMany({
        where: {
          id: tokenId,
          userId,
          consumedAt: null,
          expiresAt: { gt: NOW },
        },
        data: { consumedAt: NOW },
      });

      if (count !== 1) {
        throw AuthErrors.InvalidTokenError.reset();
      }

      await this.usersService.updatePasswordHash(userId, newHash, tx);
    });
  }
}
