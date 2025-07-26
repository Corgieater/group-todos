import {
  Catch,
  ExceptionFilter,
  UnauthorizedException,
  ArgumentsHost,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch(UnauthorizedException)
export class RedirectUnauthorizedFilter implements ExceptionFilter {
  catch(exception: UnauthorizedException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    req.session.flash = {
      type: 'error',
      message: 'Please log in first',
    };

    res.redirect('/auth/signin');
  }
}
