import {
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  UnauthorizedException,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { setSession } from '../helpers/flash-helper';

@Catch(UnauthorizedException)
export class UnauthorzedFilter implements ExceptionFilter {
  catch(e: UnauthorizedException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    setSession(req, 'error', 'Please log in first!');
    return res.redirect('/auth/signin');
  }
}
