import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  Body,
  ForbiddenException,
  UseGuards,
  BadRequestException,
  Param,
  ParseIntPipe,
  UseFilters,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import {
  AuthSigninDto,
  AuthSignupDto,
  AuthUpdatePasswordDto,
  AuthForgotPasswordDto,
  AuthResetPasswordDto,
} from './dto/auth.dto';
import { Response, Request } from 'express';
import { CurrentUserDecorator } from 'src/common/decorators/user.decorator';
import { CurrentUser } from 'src/common/types/current-user';
import {
  AuthUpdatePasswordPayload,
  AuthResetPasswordPayload,
} from './types/auth';
import { setSession } from 'src/common/helpers/flash-helper';
import { ResetPasswordTokenGuard } from './guards/reset-password-token.guard';
import { AccessTokenGuard } from './guards/access-token.guard';
import { AuthPageFilter } from 'src/common/filters/auth-page.filter';

@Controller('api/auth')
@UseFilters(AuthPageFilter)
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
    await this.authService.signup(dto);
    req.session.flash = {
      type: 'success',
      message: 'Account apply succeed, please login!',
    };
    return res.redirect('/');
  }

  @Post('signin')
  @UseFilters(AuthPageFilter)
  async signin(
    @Req() req: Request,
    @Body() dto: AuthSigninDto,
    @Res() res: Response,
  ) {
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

  @UseGuards(AccessTokenGuard)
  @UseFilters(AuthPageFilter)
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
    await this.authService.changePassword(payload);
    setSession(req, 'success', 'Password changed');
    res.clearCookie('grouptodo_login');
    return res.redirect('/');
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

  @Get('verify-reset-token/:id/:token')
  async verifyResetToken(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    const result = await this.authService.verifyResetToken(id, token);
    res.cookie('grouptodo_reset_password', result?.accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: this.config.get<number>('RESET_PASSWORD_COOKIE_MAX_AGE'),
    });
    setSession(req, 'success', 'Token valid, please reset your password!');
    return res.redirect('/auth/reset-password');
  }

  @UseGuards(ResetPasswordTokenGuard)
  @Post('reset-password/confirm')
  async confirmResetPassword(
    @Req() req: Request,
    @Body() dto: AuthResetPasswordDto,
    @Res() res: Response,
  ) {
    const { userId, tokenId } = req.user as AuthResetPasswordPayload;
    await this.authService.confirmResetPassword(
      tokenId,
      userId,
      dto.newPassword,
      dto.confirmPassword,
    );
    res.clearCookie('grouptodo_reset_password');
    setSession(req, 'success', 'Reset password succeed, please re-login!');
    res.redirect('/');
  }
}
