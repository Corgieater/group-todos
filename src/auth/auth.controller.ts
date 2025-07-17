import {
  Controller,
  Post,
  Req,
  Res,
  Body,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthSignupDto } from './dto/auth-signup.dto';
import { Response, Request } from 'express';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}
  @Post('signup')
  async signup(
    @Req() req: Request,
    @Body() dto: AuthSignupDto,
    @Res() res: Response,
  ) {
    try {
      await this.authService.signup(dto);
      req.session.flash = {
        type: 'success',
        message: 'Account apply succeed, please login!',
      };
      return res.redirect('/');
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() === HttpStatus.CONFLICT) {
        req.session.flash = { type: 'error', message: 'Email already taken' };
        return res.redirect('/auth/signup');
      }
      throw e;
    }
  }
}
