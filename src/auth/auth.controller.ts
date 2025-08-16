import {
  Controller,
  Post,
  Req,
  Res,
  Body,
  HttpStatus,
  HttpException,
  ForbiddenException,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import {
  AuthSigninDto,
  AuthSignupDto,
  AuthUpdatePasswordDto,
  AuthForgotPasswordDto,
} from './dto/auth.dto';
import { Response, Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUserDecorator } from 'src/common/decorators/user.decorator';
import { CurrentUser } from 'src/common/types/current-user';
import { AuthUpdatePasswordPayload } from './types/auth';
import { setSession } from 'src/common/helpers/flash-helper';

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private config: ConfigService,
  ) {}
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
      const { accessToken } = await this.authService.signin(
        dto.email,
        dto.password,
      );
      res.cookie('grouptodo_login', accessToken, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: this.config.get<number>('LOGIN_COOKIE_MAX_AGE'),
      });
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
  @Post('signout')
  signout(@Req() req: Request, @Res() res: Response) {
    res.clearCookie('grouptodo_login');
    req.session.flash = {
      type: 'success',
      message: 'Signed out successfully',
    };
    return res.redirect('/');
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  async changePassword(
    @Req() req: Request,
    @CurrentUserDecorator() user: CurrentUser,
    @Body() dto: AuthUpdatePasswordDto,
    @Res() res: Response,
  ) {
    const { userName: _, ...rest } = user;
    const payload: AuthUpdatePasswordPayload = {
      ...rest,
      ...dto,
    };
    try {
      await this.authService.changePassword(payload);
      setSession(req, 'success', 'Password changed');
      res.clearCookie('grouptodo_login');
      return res.redirect('/');
    } catch (e) {
      if (e instanceof ForbiddenException || e instanceof BadRequestException) {
        setSession(req, 'error', e.message);
        return res.redirect('/users/home');
      }
      throw e;
    }
  }

  @Post('reset-password')
  async resetPassword(
    @Req() req: Request,
    @Body() dto: AuthForgotPasswordDto,
    @Res() res: Response,
  ) {
    await this.authService.resetPassword(dto.email);

    req.session.flash = {
      type: 'success',
      message:
        'If this email is registered, a password reset link has been sent.',
    };
    return res.redirect('/');
  }
}
