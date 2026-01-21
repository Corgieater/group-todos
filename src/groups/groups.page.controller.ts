import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AccessTokenGuard } from 'src/auth/guards/access-token.guard';
import { CurrentUserDecorator } from 'src/common/decorators/user.decorator';
import { CurrentUser } from 'src/common/types/current-user';
import { GroupsService } from './groups.service';
import { buildGroupVM } from 'src/common/helpers/util';
import { GroupsPageFilter } from 'src/common/filters/group-page.filter';
import { TasksService } from 'src/tasks/tasks.service';
import { GroupsErrors } from 'src/errors';

@Controller('groups')
@UseGuards(AccessTokenGuard)
@UseFilters(GroupsPageFilter)
export class GroupsPageController {
  constructor(
    private groupsService: GroupsService,
    private tasksService: TasksService,
  ) {}

  @Get('new')
  async getCreateForm(@Req() req: Request, @Res() res: Response) {
    return res.render('groups/new');
  }

  @Get('list')
  async list(
    @Res() res: Response,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() req: Request,
  ) {
    const membership = await this.groupsService.getGroupListByUserId(
      user.userId,
    );

    return res.render('groups/list', {
      groups: membership.map((m) => m.group),
    });
  }

  @Get(':id/invitation')
  async getInviteForm(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    return res.render('groups/invite', { id });
  }

  @Get(':id')
  async detail(
    @Req() req: Request,
    @CurrentUserDecorator() user: CurrentUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const group = await this.groupsService.getGroupDetailsByMemberId(
      id,
      user.userId,
    );
    const viewModel = buildGroupVM(group, user.timeZone);

    // 推導檢視者角色
    const viewer = viewModel.members.find(
      (m) => m.user && m.user.id === user.userId,
    );
    const isOwner = viewModel.ownerId === user.userId;
    const isAdmin = !!viewer && viewer.role === 'ADMIN';
    const canManageMembers = isOwner || isAdmin;

    res.render('groups/details', {
      group: {
        id: viewModel.id,
        name: viewModel.name,
        createdAtLabel: viewModel.createdAtLabel,
        updatedAtLabel: viewModel.updatedAtLabel,
      },
      owner: viewModel.owner,
      members: viewModel.members,
      currentUserId: user.userId,
      isOwner,
      isAdmin,
      canManageMembers,
    });
  }

  @Get(':id/tasks')
  async groupTaskHome(
    @Req() req: Request,
    @CurrentUserDecorator() user: CurrentUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    // 1) 權限檢查保持不變
    const viewerRole = await this.groupsService.requireMemberRole(
      id,
      user.userId,
    );
    const isAdminish = this.groupsService.isAdminish(viewerRole.role);

    // 2) 取得優化後的資料（已限量、已分類、已排序、已標記 canClose）
    const dashboardData = await this.tasksService.getGroupDashboardData(
      id,
      user,
    );

    // 3) 渲染
    return res.render('groups/tasks-home', {
      groupId: id,
      groupName: viewerRole.groupName, // 可考慮從 groupsService 順便抓回 groupName
      viewerId: user.userId,
      viewerRole,
      isAdminish,
      csrfToken: (req as any).csrfToken ? (req as any).csrfToken() : '',

      // 分區資料
      expired: dashboardData.expired,
      today: dashboardData.today,
      none: dashboardData.none,

      // 傳入限制常數，方便 Pug 顯示「查看更多」按鈕
      LIMITS: { EXPIRED: 5, TODAY: 15, NONE: 10 },
    });
  }

  @Get(':id/tasks/create')
  async createTask(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUserDecorator() user: CurrentUser,
    @Res() res: Response,
  ) {
    const member = await this.groupsService.getMember(id, user.userId);

    if (!member) {
      throw GroupsErrors.GroupNotFoundError.byId(user.userId, id);
    }

    const members = await this.groupsService.listMembersBasic(id); // [{id,name,email}, ...]

    // 3) 產 CSRF（依你的架構）
    const csrfToken = (req as any).csrfToken?.() ?? res.locals.csrfToken;

    // 4) render
    return res.render('groups/tasks-create', {
      group: member.group,
      members, // 不想同時指派就別傳這個
      csrfToken,
      form: null, // 驗證失敗回填可放這裡,
      actionPath: `/api/groups/${member.group.id}/tasks`,
      backPath: `/groups/${member.group.id}/tasks`,
    });
  }
}
