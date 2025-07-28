import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { UserPayload } from 'src/common/types/user-payload';
import { User } from 'src/common/decorators/user.decorator';

@Controller('users')
export class UsersPageController {
  @UseGuards(JwtAuthGuard)
  @Get('home')
  async userPage(@User() user: UserPayload, @Res() res: Response) {
    return res.render('user/user-page', { name: user.userName });
  }
}
