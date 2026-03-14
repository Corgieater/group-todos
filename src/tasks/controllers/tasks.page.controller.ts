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
} from '@nestjs/common';
import { GetCurrentUser } from 'src/common/decorators/user.decorator';
import { CurrentUser } from 'src/common/types/current-user';
import { Request, Response } from 'express';
import { TasksService } from '../services/tasks.service';
import { TasksPageFilter } from 'src/common/filters/tasks-page.filter';
import { buildTaskVM } from 'src/common/helpers/util';
import { PrismaService } from 'src/prisma/prisma.service';
import { TaskQueryDto } from '../dto/tasks.dto';
import { SubTasksService } from '../services/sub-tasks.service';

@Controller('tasks')
@UseFilters(TasksPageFilter)
export class TasksPageController {
  constructor(
    private tasksService: TasksService,
    private subTaskService: SubTasksService,
    private prismaService: PrismaService,
  ) {}

  @Get('home')
  async home(
    @Req() req: Request,
    @GetCurrentUser() user: CurrentUser,
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
  create(@Res() res: Response) {
    res.render('tasks/create-task');
  }

  /**
   * @todo
   * Add PENDING in TaskQueryDto for filtering pending tasks
   */
  @Get('list')
  async list(
    @Query() query: TaskQueryDto,
    @GetCurrentUser() user: CurrentUser,
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
    @GetCurrentUser() user: CurrentUser,
    @Res() res: Response,
  ) {
    const { task, isAdminish, isRealAdmin, canClose, groupMembers } =
      await this.tasksService.getTaskForViewer(id, user.userId);

    const viewerAssignment = await this.prismaService.taskAssignee.findUnique({
      where: { taskId_assigneeId: { taskId: id, assigneeId: user.userId } },
      include: {
        assignedBy: { select: { name: true } },
      },
    });

    const viewModel = buildTaskVM(task, user.timeZone, isAdminish);

    res.render('tasks/details', {
      ...viewModel,
      // 🚀 關鍵 1：確保 ownerId 被傳入，Pug 才能判斷使用者是否為 Task Owner
      ownerId: task.ownerId,

      // 🚀 關鍵 2：確保 isAdminish 是 getTaskForViewer 計算出來的結果
      // 如果 buildTaskVM 裡面也有 isAdminish 且不包含 Owner，會被覆蓋
      isAdminish: isRealAdmin,

      taskId: viewModel.id,
      todayISO: new Date().toISOString().slice(0, 10),

      viewerIsAssignee: !!viewerAssignment,
      viewerAssigneeStatus: viewerAssignment?.status ?? null,
      viewerAssigneeId: viewerAssignment?.assigneeId ?? null,

      allowSelfAssign: !!task.groupId,
      canClose, // 這裡來自 getTaskForViewer 的邏輯
      groupMembers,
      currentUserId: user.userId,
      currentUserName: user.userName,
    });
  }

  @Get(':id/edit')
  async edit(
    @Param('id', ParseIntPipe) id: number,
    @GetCurrentUser() user: CurrentUser,
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
    @GetCurrentUser() user: CurrentUser,
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
    @GetCurrentUser() user: CurrentUser,
  ) {
    // 1. 獲取核心資料 (使用我們剛剛重構的 getSubTaskForViewer)
    const { subTask, isAdminish, isRealAdmin, groupMembers } =
      await this.subTaskService.getSubTaskForViewer(taskId, id, user.userId);

    // 2. 獲取當前登入者在「這個子任務」中的指派狀態
    const viewerAssignment =
      await this.prismaService.subTaskAssignee.findUnique({
        where: {
          subTaskId_assigneeId: { subTaskId: id, assigneeId: user.userId },
        },
        select: { assigneeId: true, status: true },
      });

    // 3. 建立基礎 ViewModel (處理時間與狀態標籤)
    // 注意：這裡第三個參數傳入 isAdminish，讓 buildTaskVM 知道是否具備編輯權限
    const viewModel = buildTaskVM(subTask, user.timeZone, isAdminish);

    // 4. Render 到 Pug
    res.render('tasks/sub-task-details', {
      ...viewModel,

      // 🚀 關鍵 1：傳入 Parent Task 的 ownerId (解決個人頁面按鈕消失問題)
      // 這樣 Pug 裡的 const isOwner = Number(ownerId) === Number(currentUserId) 才會成功
      ownerId: subTask.task.ownerId,

      // 🚀 關鍵 2：isAdminish 傳入 isRealAdmin
      // 在你的 Pug 裡，canFinalizeSubTask = !!isAdminish，這應該由真正的 Admin 權限控制
      isAdminish: isRealAdmin,

      // 🚀 關鍵 3：taskId 使用路徑參數的 taskId，確保麵包屑導航正確
      taskId: taskId,
      todayISO: new Date().toISOString().slice(0, 10),

      // --- 📋 指派狀態與領取控制 ---
      viewerIsAssignee: !!viewerAssignment,
      viewerAssigneeStatus: viewerAssignment?.status ?? null,
      viewerAssigneeId: user.userId,

      // 只有群組任務才允許 Self Assign
      allowSelfAssign: !!subTask.task.groupId,

      // 這裡我們假設子任務的關閉權限直接看 assignees 狀態（Pug 裡面已經有算 subTaskCanClose）
      groupMembers,
      currentUserId: user.userId,
    });
  }

  @Get(':taskId/sub-tasks/:id/edit')
  async editSubTaskDetail(
    @Res() res: Response,
    @Param('taskId', ParseIntPipe) taskId: number,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @GetCurrentUser() user: CurrentUser,
  ) {
    const { subTask, isAdminish, groupMembers } =
      await this.subTaskService.getSubTaskForViewer(taskId, id, user.userId);

    const viewModel = buildTaskVM(subTask, user.timeZone, false);

    res.render('tasks/sub-task-details-edit', {
      ...viewModel,
      taskId,
    });
  }
}
