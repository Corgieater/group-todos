import { Injectable, UnauthorizedException } from '@nestjs/common';
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
      audience: 'reset-password',
      ignoreExpiration: false,
    });
  }

  async validate(payload: ResetPasswordAccessTokenPayload) {
    if (payload.tokenUse !== 'resetPassword') {
      throw new UnauthorizedException('Wrong token use');
    }
    if (!payload.sub) {
      throw new UnauthorizedException('Malformed token');
    }
    return {
      userId: Number(payload.sub),
      email: payload.email,
      userName: payload.userName,
    };
  }
}
