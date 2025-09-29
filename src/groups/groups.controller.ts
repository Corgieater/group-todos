import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { GroupsService } from './groups.service';
import { AccessTokenGuard } from 'src/auth/guards/access-token.guard';
import { Request, Response } from 'express';
import { CurrentUserDecorator } from 'src/common/decorators/user.decorator';
import { CurrentUser } from 'src/common/types/current-user';
import { createGroupDto, inviteGroupMemberDto } from './dto/groups.dto';
import { setSession } from 'src/common/helpers/flash-helper';

@Controller('/api/groups')
@UseGuards(AccessTokenGuard)
export class GroupsController {
  constructor(private groupsService: GroupsService) {}

  @Post()
  async create(
    @Req() req: Request,
    @CurrentUserDecorator() user: CurrentUser,
    @Body() dto: createGroupDto,
    @Res() res: Response,
  ) {
    await this.groupsService.createGroup(user.userId, dto.name);
    setSession(req, 'success', 'Group created');
    res.redirect('/users/home');
  }

  @Post(':id/invitations')
  async invite(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUserDecorator() user: CurrentUser,
    @Body() dto: inviteGroupMemberDto,
    @Res() res: Response,
  ) {
    await this.groupsService.inviteGroupMember(id, user.userId, dto.email);

    setSession(req, 'success', 'Invitation suceed.');
    res.redirect(`/groups/${id}`);
  }
}
