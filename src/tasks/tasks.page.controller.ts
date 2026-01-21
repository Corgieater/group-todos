import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Render,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from 'src/auth/guards/access-token.guard';
import { CurrentUserDecorator } from 'src/common/decorators/user.decorator';
import { CurrentUser } from 'src/common/types/current-user';
import { Request, Response } from 'express';
import { TasksService } from './tasks.service';
import { TasksPageFilter } from 'src/common/filters/tasks-page.filter';
import { buildTaskVM } from 'src/common/helpers/util';
import { PrismaService } from 'src/prisma/prisma.service';
import { TaskQueryDto } from './dto/tasks.dto';

@Controller('tasks')
@UseGuards(AccessTokenGuard)
@UseFilters(TasksPageFilter)
export class TasksPageController {
  constructor(
    private tasksService: TasksService,
    private prismaService: PrismaService,
  ) {}

  @Get('home')
  async home(
    @Req() req: Request,
    @CurrentUserDecorator() user: CurrentUser,
    @Res() res: Response,
  ) {
    const dashboardData = await this.tasksService.getHomeDashboardData(user);

    return res.render('tasks/home', {
      name: user.userName,
      expired: dashboardData.expired,
      today: dashboardData.today,
      none: dashboardData.none,
      // 如果有需要顯示「查看更多」的按鈕，也可以在這裡判斷是否達到上限
    });
  }

  @Get('create')
  async create(@Res() res: Response) {
    res.render('tasks/create-task');
  }

  @Get('list')
  async list(
    @Query() query: TaskQueryDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Res() res: Response,
  ) {
    const page = query.page ? query.page : 1;
    const limit = query.limit ? query.limit : 10;

    const pageDto = await this.tasksService.getTasks(
      user.userId,
      user.timeZone,
      {
        ...query,
        page,
        limit,
      },
    );

    const viewModel = pageDto.data.map((t: any) => {
      const vm = buildTaskVM(t, user.timeZone, true);
      vm.hasOpenItems =
        Number(t.subTaskCount || 0) + Number(t.assigneeCount || 0) > 0;
      return vm;
    });

    return res.render('tasks/list-by-status', {
      status: query.scope === 'FUTURE' ? 'Future' : query.status || 'All',
      viewModel,
      pageMeta: pageDto.meta,
      currentQuery: query,
    });
  }

  @Get(':id')
  async detail(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUserDecorator() user: CurrentUser,
    @Res() res: Response,
  ) {
    const { task, isAdminish, canClose, groupMembers } =
      await this.tasksService.getTaskForViewer(id, user.userId);

    const viewerAssignment = await this.prismaService.taskAssignee.findUnique({
      where: { taskId_assigneeId: { taskId: id, assigneeId: user.userId } },
      include: {
        assignedBy: {
          select: { name: true },
        },
      },
    });

    const viewModel = buildTaskVM(task, user.timeZone, isAdminish);
    res.render('tasks/details', {
      ...viewModel,
      taskId: viewModel.id,
      todayISO: new Date().toISOString().slice(0, 10),

      viewerIsAssignee: !!viewerAssignment,
      viewerAssigneeStatus: viewerAssignment?.status ?? null,
      viewerAssigneeId: viewerAssignment?.assigneeId ?? null,

      // ★ 允許自我指派（群組任務且是群組成員）
      allowSelfAssign: !!task.groupId, // 也可更嚴謹：!!task.groupId && isMember
      canClose,
      groupMembers,
      currentUserId: user.userId,
      currentUserName: user.userName,
    });
  }

  @Get(':id/edit')
  async edit(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUserDecorator() user: CurrentUser,
    @Res() res: Response,
  ) {
    const { task, isAdminish } = await this.tasksService.getTaskForViewer(
      id,
      user.userId,
    );

    const viewModel = buildTaskVM(task, user.timeZone, isAdminish);

    res.render('tasks/details-edit', {
      ...viewModel,
      todayISO: new Date().toISOString().slice(0, 10),
    });
  }

  // ------------------------- Sub-Tasks -----------------------
  @Get(':taskId/sub-tasks/partial')
  @Render('partials/_subtask-list') // 💡 指定只渲染這個片段
  async getSubTasksPartial(
    @Param('taskId', ParseIntPipe) taskId: number,
    @CurrentUserDecorator() user: CurrentUser,
    @Req() req: any,
  ) {
    const csrfToken = req.csrfToken();
    // 🚀 關鍵：呼叫跟 detail 相同的 Service 方法
    const { task, isAdminish, canClose } =
      await this.tasksService.getTaskForViewer(taskId, user.userId);

    // 💡 這裡一樣使用 buildTaskVM，確保時間格式、標籤等變數名稱一致
    // 假設 buildTaskVM 回傳的物件包含 subTasks, id 等
    const viewModel = buildTaskVM(task, user.timeZone, isAdminish);

    // 💡 回傳 _subtask-list.pug 需要的所有變數
    return {
      ...viewModel, // 這包含了 subTasks, taskId (或 id) 等
      taskId: task.id, // 確保變數名跟模板裡的 action 一致
      isGroup: !!task.groupId,
      isAdminish,
      viewerAssigneeId: user.userId,
      statusColorMap: {
        OPEN: 'warning',
        CLOSED: 'success',
        ARCHIVED: 'secondary',
      },
      csrfToken,
    };
  }

  @Get(':id/sub-tasks/create')
  async renderCreateSubTaskPage(
    @Res() res: Response,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    const parentTask = await this.prismaService.task.findUnique({
      where: { id },
      select: { id: true, title: true },
    });
    res.render('tasks/create-sub-task', {
      parentTaskId: id,
      parentTaskTitle: parentTask?.title,
    });
  }

  @Get(':taskId/sub-tasks/:id')
  async subTaskDetail(
    @Res() res: Response,
    @Param('taskId', ParseIntPipe) taskId: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @CurrentUserDecorator() user: CurrentUser,
  ) {
    // 1. 獲取 SubTask 詳情 (包含 assignees 列表)
    const { subTask, isAdminish, groupMembers } =
      await this.tasksService.getSubTaskForViewer(taskId, id, user.userId);

    // 2. 獲取當前登入者在「這個子任務」中的指派狀態
    const viewerAssignment =
      await this.prismaService.subTaskAssignee.findUnique({
        where: {
          subTaskId_assigneeId: { subTaskId: id, assigneeId: user.userId },
        },
        select: { assigneeId: true, status: true, updatedAt: true },
      });

    // 3. 建立基礎 ViewModel
    // 注意：這裡的 isAdminish 可以根據業務需求決定，通常子任務細節頁面也要傳入權限
    const viewModel = buildTaskVM(subTask, user.timeZone, false);

    // 4. Render
    res.render('tasks/sub-task-details', {
      ...viewModel,
      taskId,
      isAdminish,
      groupMembers,
      // --- 🚨 驅動 Pug 模板按鈕的關鍵變數 ---
      viewerIsAssignee: !!viewerAssignment,
      viewerAssigneeStatus: viewerAssignment?.status ?? null,
      viewerAssigneeId: user.userId,

      // 只要是群組任務就允許領取 (Service 內會再做一次成員檢查)
      // 如果 subTask.task 存在，可以從那裡判斷；這裡直接用 viewModel 是否有 groupId
      allowSelfAssign: !!viewModel.groupId || true,
    });
  }

  @Get(':taskId/sub-tasks/:id/edit')
  async editSubTaskDetail(
    @Res() res: Response,
    @Param('taskId', ParseIntPipe) taskId: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @CurrentUserDecorator() user: CurrentUser,
  ) {
    const { subTask, isAdminish, groupMembers } =
      await this.tasksService.getSubTaskForViewer(taskId, id, user.userId);

    const viewModel = buildTaskVM(subTask, user.timeZone, false);

    res.render('tasks/sub-task-details-edit', {
      ...viewModel,
      taskId,
    });
  }
}
