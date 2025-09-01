import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AccessTokenGuard } from 'src/auth/guards/access-token.guard';
import { CurrentUser } from 'src/common/types/current-user';
import { CurrentUserDecorator } from 'src/common/decorators/user.decorator';

@Controller('users')
export class UsersPageController {
  @UseGuards(AccessTokenGuard)
  @Get('home')
  async home(@CurrentUserDecorator() user: CurrentUser, @Res() res: Response) {
    return res.render('users/home', { name: user.userName });
  }
}
