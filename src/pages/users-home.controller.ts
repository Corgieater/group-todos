import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { GetCurrentUser } from 'src/common/decorators/user.decorator';
import { CurrentUser } from 'src/common/types/current-user';

@Controller('users-home')
export class UsersHomeController {
  @Get()
  async home(
    @Req() req: Request,
    @GetCurrentUser() user: CurrentUser,
    @Res() res: Response,
  ) {
    return res.render('users/home', {
      name: user.userName,
    });
  }
}
