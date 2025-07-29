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
import { AuthService } from './auth.service';
import { AuthSigninDto, AuthSignupDto } from './dto/auth.dto';
import { Response, Request } from 'express';
import { AuthUpdatePasswordDto } from './dto/auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { User } from 'src/common/decorators/user.decorator';
import { UserPayload } from 'src/common/types/user-payload';
import { AuthUpdatePasswordPayload } from './types/auth';
import { setSession } from 'src/common/helpers/flash-helper';

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
  @Post('signout')
  signout(@Req() req: Request, @Res() res: Response) {
    res.clearCookie('jwt');
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
    @User() user: UserPayload,
    @Body() dto: AuthUpdatePasswordDto,
    @Res() res: Response,
  ) {
    const payload: AuthUpdatePasswordPayload = {
      ...user,
      ...dto,
    };
    try {
      await this.authService.changePassword(payload);
      setSession(req, 'success', 'Password changed');
      res.clearCookie('jwt');
      return res.redirect('/');
    } catch (e) {
      if (e instanceof ForbiddenException || e instanceof BadRequestException) {
        setSession(req, 'error', e.message);
        return res.redirect('/users/home');
      }
      // NOTE:
      // should i directly throw e?
      // how to deal with this?
      // a filter to see unsolved error and document it?
      throw e;
    }
  }
}
