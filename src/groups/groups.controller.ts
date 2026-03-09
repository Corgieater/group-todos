import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { GroupsService } from './groups.service';
import { Request, Response } from 'express';
import { GetCurrentUser } from 'src/common/decorators/user.decorator';
import { CurrentUser } from 'src/common/types/current-user';
import {
  CreateGroupDto,
  InviteGroupMemberDto,
  KickOutMemberFromGroupDto,
  UpdateGroupDto,
  UpdateMemberRoleDto,
} from './dto/groups.dto';
import { setSession } from 'src/common/helpers/flash-helper';
import { GroupsPageFilter } from 'src/common/filters/group-page.filter';
import { TasksService } from 'src/tasks/tasks.service';
import { TasksAddDto } from 'src/tasks/dto/tasks.dto';
import { TasksAddPayload } from 'src/tasks/types/tasks';
import { Public } from 'src/common/decorators/public.decorator';
import { SecurityService } from 'src/security/security.service';
import {
  MemberRoles,
  RequireRoles,
} from 'src/common/decorators/require-roles.decorator';
import { GroupRolesGuard } from 'src/groups/guard/group-role.guard';

@Controller('/api/groups')
@UseGuards(GroupRolesGuard)
@UseFilters(GroupsPageFilter)
export class GroupsController {
  constructor(
    private groupsService: GroupsService,
    private tasksService: TasksService,
    private securityService: SecurityService,
  ) {}

  @Post('new')
  async create(
    @Req() req: Request,
    @GetCurrentUser() user: CurrentUser,
    @Body() dto: CreateGroupDto,
    @Res() res: Response,
  ) {
    await this.groupsService.createGroup(user.userId, dto.name);
    setSession(req, 'success', 'Group created');
    res.redirect('/groups/list');
  }

  @Post(':id/update')
  @RequireRoles([MemberRoles.OWNER])
  async update(
    @Req() req: Request,
    @GetCurrentUser() user: CurrentUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGroupDto,
    @Res() res: Response,
  ) {
    try {
      await this.groupsService.updateGroup(user.userId, id, dto.name);
      setSession(req, 'success', 'Group info updated');
    } catch (e) {
      setSession(req, 'error', e.message);
    }

    const backUrl = req.header('Referer') || '/groups/list';
    res.redirect(backUrl);
  }

  @Post(':id/invitations')
  @RequireRoles([MemberRoles.OWNER, MemberRoles.ADMIN])
  async invite(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @GetCurrentUser() user: CurrentUser,
    @Body() dto: InviteGroupMemberDto,
    @Res() res: Response,
  ) {
    const mailSent = await this.groupsService.inviteGroupMember(
      id,
      user.userId,
      dto.email,
    );
    if (mailSent) {
      setSession(req, 'success', 'Invitation suceed.');
    } else {
      setSession(
        req,
        'warning',
        'Sending Email fails, please check env variables',
      );
    }

    res.redirect(`/groups/${id}`);
  }

  @Public()
  @Get('invitation/:id/:token')
  async verifyInvitation(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    const payload = await this.groupsService.verifyInvitation(id, token);
    const accessToken = await this.securityService.signAccessToken(payload);

    res.cookie(
      'grouptodo_login',
      accessToken,
      this.securityService.getCookieOptions(),
    );
    setSession(req, 'success', 'You have been invited to a group!');
    res.redirect(`/groups/list`);
  }

  @Post(':id/update/role')
  @RequireRoles([MemberRoles.OWNER])
  async updateMemberRole(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @GetCurrentUser() user: CurrentUser,
    @Body() dto: UpdateMemberRoleDto,
    @Res() res: Response,
  ) {
    await this.groupsService.updateMemberRole(
      id,
      dto.memberId,
      dto.newRole,
      user.userId,
    );
    setSession(req, 'success', 'Member role have been updated');
    res.redirect(`/groups/${id}`);
  }

  @Post(':id/disband')
  @RequireRoles([MemberRoles.OWNER])
  async disband(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @GetCurrentUser() user: CurrentUser,
    @Res() res: Response,
  ) {
    await this.groupsService.disbandGroupById(id, user.userId);

    setSession(req, 'success', 'Group has been disbanded');
    res.redirect('/users-home');
  }

  @Post(':id/leave')
  async leave(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @GetCurrentUser() user: CurrentUser,
    @Res() res: Response,
  ) {
    await this.groupsService.leaveGroup(id, user.userId);
    setSession(req, 'success', 'You have left the group.');
    res.redirect(`/users-home`);
  }

  @Post(':id/kick-out-members')
  @RequireRoles([MemberRoles.OWNER, MemberRoles.ADMIN])
  async kickOutMember(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @GetCurrentUser() user: CurrentUser,
    @Body() dto: KickOutMemberFromGroupDto,
    @Res() res: Response,
  ) {
    await this.groupsService.kickOutMember(id, dto.memberId, user.userId);
    setSession(req, 'success', 'Member already removed from group.');
    res.redirect(`/groups/${id}`);
  }

  @Post(':id/tasks')
  async createGroupTask(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @GetCurrentUser() user: CurrentUser,
    @Body() dto: TasksAddDto,
    @Res() res: Response,
  ) {
    await this.groupsService.checkIfMember(id, user.userId);

    // TODO: deal with asignees
    const payload: TasksAddPayload = {
      title: dto.title,
      status: dto.status ?? null,
      priority: dto.priority ?? null,
      description: dto.description ?? null,
      allDay: dto.allDay,
      dueDate: dto.dueDate ?? null,
      dueTime: dto.dueTime ?? null,
      location: dto.location ?? null,
      userId: user.userId,
    };
    await this.tasksService.createTask(payload, id);
    setSession(req, 'success', 'Group task added.');

    return res.redirect(`/groups/${id}/tasks`);
  }
}
