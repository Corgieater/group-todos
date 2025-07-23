import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from 'src/auth/auth.service';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';

@Controller('users')
export class UsersPageController {
  @UseGuards(JwtAuthGuard)
  @Get('home')
  async userPage(@Req() req: Request, @Res() res: Response) {
    const user = req.user as { userId: number; userName: string };
    return res.render('user/user-page', { name: user.userName });
  }
}
