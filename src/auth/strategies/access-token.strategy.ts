import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { NormalAccessTokenPayload } from 'src/security/type/accessToken.interface';

// this part tell what to extractor from cookie
function cookieExtractor(req: Request): string | null {
  return req?.cookies?.grouptodo_login ?? null;
}

// from import { PassportStrategy } from '@nestjs/passport'; already tell that i use jwt
// we don't need to add jwt in class name
@Injectable()
export class AccessTokenStrategy extends PassportStrategy(
  Strategy,
  'access-token',
) {
  constructor(private config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor]),
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      ignoreExpiration: false,
    });
  }

  // validate function to deal with payload, and decide return form
  validate(payload: NormalAccessTokenPayload) {
    if (payload.tokenUse !== 'access') {
      throw new UnauthorizedException('Invalid access token');
    }
    const { sub, ...rest } = payload;
    return { userId: sub, ...rest };
  }
}
