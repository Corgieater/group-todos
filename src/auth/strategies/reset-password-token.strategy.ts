import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { BaseAccessTokenPayload } from '../types/auth';
import { AuthErrors } from 'src/errors';

interface ResetPasswordAccessTokenPayload extends BaseAccessTokenPayload {
  tokenUse: 'resetPassword';
  tokenId: number;
}

function cookieExtractor(req: Request): string | null {
  return req?.cookies?.grouptodo_reset_password ?? null;
}

@Injectable()
export class ResetPasswordTokenStrategy extends PassportStrategy(
  Strategy,
  'reset-password-token',
) {
  constructor(private config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor]),
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      ignoreExpiration: false,
    });
  }

  validate(payload: ResetPasswordAccessTokenPayload) {
    if (payload.tokenUse !== 'resetPassword' || payload.tokenId == null) {
      throw AuthErrors.InvalidTokenError.reset({ cause: 'invalid tokenUse' });
    }
    const { sub, ...rest } = payload;
    return { userId: sub, ...rest };
  }
}
