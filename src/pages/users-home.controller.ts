import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AccessTokenGuard } from 'src/auth/guards/access-token.guard';
import { CurrentUserDecorator } from 'src/common/decorators/user.decorator';
import { CurrentUser } from 'src/common/types/current-user';

@Controller('users-home')
export class UsersHomeController {
  @UseGuards(AccessTokenGuard)
  @Get()
  async home(
    @Req() req: Request,
    @CurrentUserDecorator() user: CurrentUser,
    @Res() res: Response,
  ) {
    return res.render('users/home', {
      name: user.userName,
    });
  }
}
