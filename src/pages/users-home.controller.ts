import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AccessTokenGuard } from 'src/auth/guards/access-token.guard';
import { CurrentUserDecorator } from 'src/common/decorators/user.decorator';
import { CurrentUser } from 'src/common/types/current-user';
import { GroupsService } from 'src/groups/groups.service';
import { UsersService } from 'src/users/users.service';

@Controller('users-home')
export class UsersHomeController {
  constructor(
    private readonly usersService: UsersService,
    private readonly groupsService: GroupsService,
  ) {}

  // TODO:
  // need to test
  @UseGuards(AccessTokenGuard)
  @Get()
  async home(
    @Req() req: Request,
    @CurrentUserDecorator() user: CurrentUser,
    @Res() res: Response,
  ) {
    const membership = await this.groupsService.getGroupListByUserId(
      user.userId,
    );
    const groups = membership.map((m) => m.group);

    return res.render('users/home', {
      name: user.userName,
      groups,
    });
  }
}
