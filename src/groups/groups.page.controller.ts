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
    // 1) 一次撈回「未完成 ∧ (今天｜無期限｜逾期)」，並拿到邊界
    const { items, bounds } =
      await this.tasksService.listGroupOpenTasksDueTodayNoneOrExpired(
        id,
        user.userId,
      );
    const tasks = items;
    const { startUtc, endUtc, startOfTodayUtc, todayDateOnlyUtc } = bounds;

    type TaskVM = (typeof tasks)[number];
    type Buckets = { expired: TaskVM[]; today: TaskVM[]; none: TaskVM[] };
    const buckets: Buckets = { expired: [], today: [], none: [] };

    // 2) 一趟 loop 分桶
    for (const t of tasks) {
      const isExpired =
        (t.dueAtUtc && t.dueAtUtc < startOfTodayUtc) ||
        (t.allDayLocalDate && t.allDayLocalDate < todayDateOnlyUtc);

      if (isExpired) {
        buckets.expired.push(t);
        continue;
      }

      const isToday =
        (t.dueAtUtc && t.dueAtUtc >= startUtc && t.dueAtUtc <= endUtc) ||
        (t.allDayLocalDate && +t.allDayLocalDate === +todayDateOnlyUtc);

      if (isToday) {
        buckets.today.push(t);
        continue;
      }

      const isNone = !t.dueAtUtc && !t.allDayLocalDate;
      if (isNone) {
        buckets.none.push(t);
        continue;
      }
      // 其他情況（例如未來）本 API 本來就不會回；若要保險可收集到 extra[]
    }

    // 3) 排序工具：把 Date|null 轉成可比較的數字
    const ts = (d: Date | null | undefined) =>
      d ? d.getTime() : Number.POSITIVE_INFINITY;

    // 今日/逾期：全日優先 → 全日日期升冪 → dueAtUtc 升冪（null 放最後）
    const sortByDay = (a: TaskVM, b: TaskVM) =>
      Number(b.allDay) - Number(a.allDay) ||
      ts(a.allDayLocalDate) - ts(b.allDayLocalDate) ||
      ts(a.dueAtUtc) - ts(b.dueAtUtc);

    // 無期限：按建立時間或優先度自行決定
    const sortByNone = (a: TaskVM, b: TaskVM) =>
      ts(a.createdAt) - ts(b.createdAt);

    buckets.today.sort(sortByDay);
    buckets.expired.sort(sortByDay);
    buckets.none.sort(sortByNone);

    // 4) render（依你的 pug 檔名調整）
    return res.render('groups/tasks-home', {
      groupId: id,
      today: buckets.today,
      expired: buckets.expired,
      none: buckets.none,
    });
  }
}
