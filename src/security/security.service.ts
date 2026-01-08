import { Injectable } from '@nestjs/common';
import * as argon from 'argon2';
import crypto, { createHmac, timingSafeEqual } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthErrors } from 'src/errors';

@Injectable()
export class SecurityService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

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

  // Task action token (for email reply)
  async signTaskActionToken(
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
      expiresIn: '24h',
      secret: this.config.get('JWT_SECRET'),
    });
  }

  async verifyTaskActionToken(
    token: string,
  ): Promise<{ taskId: number; userId: number; subTaskId?: number }> {
    try {
      const payload = await this.jwtService.verifyAsync<{
        taskId: number;
        userId: number;
        subTaskId?: number;
      }>(token, {
        secret: this.config.get('JWT_SECRET'),
      });
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
