import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from 'src/auth/auth.service';

@Controller('users')
export class UsersPageController {
  constructor(private authService: AuthService) {}
  @Get('home')
  async userPage(@Req() req: Request, @Res() res: Response) {
    // deal with no token issue
    // sent these users back to sign in
    const token = req.cookies?.jwt;
    if (typeof token !== 'string') {
      throw new UnauthorizedException('No valid JWT found');
    }
    const userInfo = await this.authService.decodeJwtToken(token);
    return res.render('user/user-page', { name: userInfo.name });
  }
}
