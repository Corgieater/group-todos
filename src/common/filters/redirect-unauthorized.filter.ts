import {
  Catch,
  ExceptionFilter,
  UnauthorizedException,
  ArgumentsHost,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { setSession } from '../helpers/flash-helper';
@Catch(UnauthorizedException)
export class RedirectUnauthorizedFilter implements ExceptionFilter {
  catch(e: UnauthorizedException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    setSession(req, 'error', 'Please log in first');

    res.redirect('/auth/signin');
  }
}
