import {
  Controller,
  Get,
  Req,
  Res,
  HttpStatus,
  UseFilters,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthPageController {
  constructor(private readonly authService: AuthService) {}
  @Get('signup')
  signupPage(@Req() req: Request, @Res() res: Response) {
    const message = req.session.flash?.message;
    delete req.session.flash;
    res.render('auth/signup', { message });
  }

  @Get('signin')
  signinPage(@Req() req: Request, @Res() res: Response) {
    return res.render('auth/signin');
  }

  @Get('forgot-password')
  forgotPassowrd(@Req() req: Request, @Res() res: Response) {
    return res.render('auth/forgot-password');
  }

  @Get('reset-password')
  resetPassword(@Req() req: Request, @Res() res: Response) {
    return res.render('auth/reset-password');
  }
}
