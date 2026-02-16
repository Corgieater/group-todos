import { Injectable } from '@nestjs/common';
import * as argon from 'argon2';
import crypto, { createHmac, timingSafeEqual } from 'crypto';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { AuthErrors } from 'src/errors';
import {
  NormalAccessTokenPayload,
  ResetPasswordTokenPayload,
} from './type/accessToken.interface';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SecurityService {
  private readonly defaultCookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
  };
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  getCookieOptions(maxAgeKey: string = 'LOGIN_COOKIE_MAX_AGE') {
    return {
      ...this.defaultCookieOptions,
      maxAge: this.config.getOrThrow<number>(maxAgeKey),
    };
  }

  //   Argon2 hasing methods
  async hash(
    raw: string,
    options?: argon.Options & { type?: number },
  ): Promise<string> {
    return await argon.hash(raw, options);
  }

  async verify(hash: string, origin: string): Promise<boolean> {
    return await argon.verify(hash, origin);
  }

  //   safe utility methods
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

  // JWT TOKEN
  private async baseSign(
    payload: NormalAccessTokenPayload | ResetPasswordTokenPayload,
    options?: JwtSignOptions,
  ): Promise<string> {
    return await this.jwtService.signAsync(payload, options);
  }

  async signAccessToken(
    payload: Omit<NormalAccessTokenPayload, 'tokenUse'>,
  ): Promise<string> {
    return this.baseSign(
      { ...payload, tokenUse: 'access' },
      { expiresIn: this.config.getOrThrow('JWT_ACCESS_TOKEN_EXPIRES_IN') },
    );
  }

  async signResetPasswordToken(
    payload: Omit<ResetPasswordTokenPayload, 'tokenUse'>,
  ): Promise<string> {
    return this.baseSign(
      { ...payload, tokenUse: 'resetPassword' },
      {
        expiresIn: this.config.getOrThrow(
          'JWT_RESET_PASSWORD_TOKEN_EXPIRES_IN',
        ),
      },
    );
  }

  async signTaskDecisionToken(
    taskId: number,
    userId: number,
    subTaskId: number | null = null,
  ): Promise<string> {
    let data: object;
    if (subTaskId) {
      data = { taskId, userId, subTaskId };
    } else {
      data = { taskId, userId };
    }
    return this.jwtService.signAsync(data, {
      expiresIn: this.config.getOrThrow('JWT_ACCESS_TOKEN_EXPIRES_IN'),
    });
  }

  async verifyTaskDecisionToken(
    token: string,
  ): Promise<{ taskId: number; userId: number; subTaskId?: number }> {
    try {
      const payload = await this.jwtService.verifyAsync<{
        taskId: number;
        userId: number;
        subTaskId?: number;
      }>(token);
      return {
        taskId: payload.taskId,
        userId: payload.userId,
        subTaskId: payload.subTaskId,
      };
    } catch (e) {
      throw AuthErrors.InvalidTokenError.verify();
    }
  }
}
