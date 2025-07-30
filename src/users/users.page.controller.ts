import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { CurrentUser } from 'src/common/types/current-user';
import { CurrentUserDecorator } from 'src/common/decorators/user.decorator';

@Controller('users')
export class UsersPageController {
  @UseGuards(JwtAuthGuard)
  @Get('home')
  async userPage(
    @CurrentUserDecorator() user: CurrentUser,
    @Res() res: Response,
  ) {
    return res.render('user/user-page', { name: user.userName });
  }
}
