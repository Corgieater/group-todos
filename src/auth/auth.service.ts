import {
  ActionTokenType,
  User as UserModel,
} from 'src/generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { AuthSignupDto } from './dto/auth.dto';
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
import { SecurityService } from 'src/security/security.service';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly securityService: SecurityService,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly prismaService: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async signup(dto: AuthSignupDto): Promise<void> {
    const existUser = await this.usersService.findByEmail(dto.email);

    if (existUser) {
      throw AuthErrors.CredentialDuplicatedError.email(dto.email);
    }

    const createUserInput = {
      name: dto.name,
      email: dto.email,
      timeZone: dto.timeZone,
      hash: await this.securityService.hash(dto.password),
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

    if (!(await this.securityService.verify(user.hash, password))) {
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

    if (!(await this.securityService.verify(user.hash, payload.oldPassword))) {
      throw new AuthErrors.InvalidOldPasswordError();
    }

    if (await this.securityService.verify(user.hash, payload.newPassword)) {
      throw new AuthErrors.PasswordReuseError();
    }

    const newHash = await this.securityService.hash(payload.newPassword);

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

    const rawToken = this.securityService.generateUrlFriendlySecret(32);
    const expiresAt = addTime(new Date(), 15, 'm');

    const serverSecret = this.config.getOrThrow<string>('TOKEN_HMAC_SECRET');
    const tokenHash = this.securityService.hmacToken(rawToken, serverSecret);

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

    this.mailService.sendPasswordReset(user, link);
  }

  async verifyResetToken(
    id: number,
    rawToken: string,
  ): Promise<{ accessToken: string }> {
    /**
     * Verifies the password reset token and issues a short-lived JWT for password updates.
     * * ### Security Implementation:
     * 1. **Integrity Check**: Re-calculates the HMAC digest of the provided `rawToken` using
     * the `TOKEN_HMAC_SECRET` and compares it against the stored `tokenHash`.
     * 2. **Timing Attack Protection**: Employs constant-time comparison via `safeEqualB64url`
     * to prevent side-channel leaks.
     * 3. **State Validation**: Ensures the token is linked to a valid user, has not expired,
     * has not been consumed, and has not been revoked.
     * 4. **Limited Scope**: The resulting JWT is scoped specifically for `resetPassword`
     * and is valid for only 10 minutes.
     *
     * @param id - The unique identifier (Primary Key) of the ActionToken in the database.
     * @param rawToken - The raw, URL-friendly secret string sent to the user's email.
     * * @returns A Promise resolving to an object containing the `accessToken` (JWT).
     * * @throws {AuthErrors.InvalidTokenError}
     * Thrown if the token ID is not found, expired, already consumed, or if the
     * HMAC verification fails.
     */
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
    const candidate = this.securityService.hmacToken(rawToken, serverSecret);

    if (!this.securityService.safeEqualB64url(result.tokenHash, candidate)) {
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
  ): Promise<void> {
    /**
     * Finalizes the password reset process after verifying the user's temporary token.
     * * ### Business Logic & Security Steps:
     * 1. **Identity Verification**: Ensures the target user exists in the system.
     * 2. **Security Compliance**: Performs a password reuse check against the current hash
     * to enforce security policies.
     * 3. **Input Validation**: Ensures the new password matches the confirmation string.
     * 4. **Secure Hashing**: Generates a new cryptographically secure hash (Argon2).
     * 5. **Atomic Transaction**:
     * - Marks the specific `ActionToken` as consumed to prevent Replay Attacks.
     * - Updates the user's password hash within the same database transaction.
     *
     * @param tokenId - The unique identifier (Primary key) of the ActionToken record.
     * @param userId - The ID of the user whose password is being reset.
     * @param newPassword - The new raw password provided by the user.
     * @param confirmPassword - A duplicate of the new password used for verification.
     *
     * @returns {Promise<void>} Resolves when the password has been successfully updated.
     * * @throws {UsersErrors.UserNotFoundError} If the provided userId does not exist.
     * @throws {AuthErrors.PasswordReuseError} If the new password is identical to the current one.
     * @throws {AuthErrors.PasswordConfirmationMismatchError} If newPassword and confirmPassword do not match.
     * @throws {AuthErrors.InvalidTokenError} If the token is already used, expired, or does not belong to the user.
     */
    const user: UserModel | null = await this.usersService.findById(userId);

    if (!user) {
      throw UsersErrors.UserNotFoundError.byId(userId);
    }

    if (await this.securityService.verify(user.hash, newPassword)) {
      throw new AuthErrors.PasswordReuseError();
    }

    if (newPassword !== confirmPassword) {
      throw new AuthErrors.PasswordConfirmationMismatchError();
    }

    const newHash = await this.securityService.hash(newPassword);
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
