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
import { AuthSigninDto, AuthSignupDto } from './dto/auth.dto';
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
      if (
        e instanceof HttpException &&
        e.getStatus() === Number(HttpStatus.CONFLICT)
      ) {
        req.session.flash = { type: 'error', message: 'Email already taken' };
        return res.redirect('/auth/signup');
      }
      throw e;
    }
  }
  @Post('signin')
  async signin(
    @Req() req: Request,
    @Body() dto: AuthSigninDto,
    @Res() res: Response,
  ) {
    try {
      const { access_token } = await this.authService.signin(
        dto.email,
        dto.password,
      );
      res.cookie('jwt', access_token);
      return res.redirect('/users/home');
    } catch (e) {
      if (
        e instanceof HttpException &&
        e.getStatus() === Number(HttpStatus.UNAUTHORIZED)
      ) {
        req.session.flash = { type: 'error', message: 'Invalid credentials' };
        return res.redirect('/auth/signin');
      }
    }
  }
}
