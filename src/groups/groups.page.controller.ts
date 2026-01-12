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
      user.userId,
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
    // // 1) 先確定使用者在群組裡，並拿到角色
    // const viewerRole = await this.groupsService.requireMemberRole(
    //   id,
    //   user.userId,
    // );
    // const isAdminish = this.groupsService.isAdminish(viewerRole);
    // // 2) 拿資料（未完成 && [今天/無截止/逾期]）
    // const { items, bounds } =
    //   await this.tasksService.listGroupOpenTasksDueTodayNoneOrExpired(
    //     id,
    //     user.userId,
    //   );
    // const { startUtc, endUtc, startOfTodayUtc, todayDateOnlyUtc } = bounds;
    // // 我們要把每一筆 task 加上 hasAssignees / allAssigneesDone
    // // 這裡先做成一個新的陣列，等會再丟進 buckets
    // const enriched = items.map((t) => {
    //   const hasAssignees = Array.isArray(t.assignees) && t.assignees.length > 0;
    //   // 你的邏輯：普通 close 只有「有 assignees 且全部完成」才成立
    //   const allAssigneesDone = hasAssignees
    //     ? t.assignees.every((a) => a.status === 'COMPLETED')
    //     : false;
    //   return {
    //     ...t,
    //     hasAssignees,
    //     allAssigneesDone,
    //   };
    // });
    // type T = (typeof enriched)[number];
    // const buckets: { expired: T[]; today: T[]; none: T[] } = {
    //   expired: [],
    //   today: [],
    //   none: [],
    // };
    // for (const t of enriched) {
    //   const expired =
    //     (t.dueAtUtc && t.dueAtUtc < startOfTodayUtc) ||
    //     (t.allDayLocalDate && t.allDayLocalDate < todayDateOnlyUtc);
    //   if (expired) {
    //     buckets.expired.push(t);
    //     continue;
    //   }
    //   const today =
    //     (t.dueAtUtc && t.dueAtUtc >= startUtc && t.dueAtUtc <= endUtc) ||
    //     (t.allDayLocalDate && +t.allDayLocalDate === +todayDateOnlyUtc);
    //   if (today) {
    //     buckets.today.push(t);
    //     continue;
    //   }
    //   if (!t.dueAtUtc && !t.allDayLocalDate) {
    //     buckets.none.push(t);
    //     continue;
    //   }
    // }
    // const ts = (d: Date | null | undefined) =>
    //   d ? d.getTime() : Number.POSITIVE_INFINITY;
    // const sortByDay = (a: T, b: T) =>
    //   Number(b.allDay) - Number(a.allDay) ||
    //   ts(a.allDayLocalDate) - ts(b.allDayLocalDate) ||
    //   ts(a.dueAtUtc) - ts(b.dueAtUtc);
    // const sortByNone = (a: T, b: T) => ts(a.createdAt) - ts(b.createdAt);
    // buckets.today.sort(sortByDay);
    // buckets.expired.sort(sortByDay);
    // buckets.none.sort(sortByNone);
    // // 3) render：把 viewer 資訊一併丟進去（pug 需要）
    // return res.render('groups/tasks-home', {
    //   groupId: id,
    //   groupName: undefined,
    //   viewerId: user.userId,
    //   viewerRole,
    //   isAdminish,
    //   csrfToken: res.locals.csrfToken,
    //   expired: buckets.expired,
    //   today: buckets.today,
    //   none: buckets.none,
    // });
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
