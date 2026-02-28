import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UseFilters,
  Get,
  Query,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { GetCurrentUser } from 'src/common/decorators/user.decorator';
import { CurrentUser } from 'src/common/types/current-user';
import {
  AssignTaskDto,
  NotificationDto,
  SubTasksAddDto,
  TasksAddDto,
  UpdateAssigneeStatusDto,
  UpdateTaskDto,
} from './dto/tasks.dto';
import { TasksService } from './tasks.service';
import {
  AssignTaskPayload,
  SubTaskAddPayload,
  TaskContext,
  TasksAddPayload,
} from './types/tasks';
import { setSession } from 'src/common/helpers/flash-helper';
import { TasksPageFilter } from 'src/common/filters/tasks-page.filter';
import { Public } from 'src/common/decorators/public.decorator';
import { AssignmentStatus } from 'src/generated/prisma/enums';
import { SerializationInterceptor } from 'src/common/interceptors/serialization/serialization.interceptor';
import { SecurityService } from 'src/security/security.service';
import { TaskMemberGuard } from './guard/task-member.guard';
import { GetTaskContext } from 'src/common/decorators/task-context.decorator';

@Controller('api/tasks')
@UseFilters(TasksPageFilter)
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly securityService: SecurityService,
  ) {}

  @Post()
  async create(
    @Req() req: Request,
    @GetCurrentUser() user: CurrentUser,
    @Body() dto: TasksAddDto,
    @Res() res: Response,
  ) {
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

    await this.tasksService.createTask(payload);
    setSession(req, 'success', 'Task added');
    return res.redirect('/tasks/home');
  }

  // edit
  // NOTE:
  // Currently allowed empty data update,
  // once frontend been separated, we can check by frontend
  @Post(':id/update')
  @UseGuards(TaskMemberGuard)
  async update(
    @Req() req: Request,
    @Body() dto: UpdateTaskDto,
    @GetCurrentUser() user: CurrentUser,
    @GetTaskContext() ctx: TaskContext,
    @Res() res: Response,
  ) {
    const updateCtx = {
      id: ctx.task.id,
      userId: ctx.userId,
      timeZone: user.timeZone,
      userName: user.userName,
      isAdminish: ctx.isAdminish,
      isOwner: ctx.isOwner,
    };
    const task = await this.tasksService.updateTask(updateCtx, dto);
    setSession(req, 'success', 'Task has been updated');
    return res.redirect(`/tasks/${task.id}`);
  }

  // self-assign, claim, assigned task status report
  @Post(':id/update/assignee-status')
  @UseGuards(TaskMemberGuard)
  async updateAssigneeStatus(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAssigneeStatusDto,
    @GetCurrentUser() user: CurrentUser,
    @Res() res: Response,
  ) {
    await this.tasksService.updateAssigneeStatus(
      id,
      user.userId,
      dto,
      user.userName,
    );
    setSession(req, 'success', 'Status has been changed.');
    return res.redirect(`/tasks/${id}`);
  }

  @Post(':id/close')
  async close(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
    @GetCurrentUser() user: CurrentUser,
    @Res() res: Response,
    @Req() req: Request, // 引入 Request 以檢查 Header
  ) {
    try {
      await this.tasksService.closeTask(id, user.userId, {
        reason: body.reason,
      });

      // 如果是 AJAX 請求 (Fetch)，回傳 JSON 成功訊息
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(200).json({ success: true });
      }

      // 如果是傳統 Form 提交，則重導向
      return res.redirect(`/tasks/${id}`);
    } catch (error) {
      console.log('Caught Error:', error);

      // 🚀 修改判斷點：從 error.code 改為檢查 error.action
      const isForceCloseRequired =
        error.action === 'FORCE_CLOSE_REASON_REQUIRED' ||
        error.message?.includes('FORCE_CLOSE_REASON_REQUIRED');

      if (isForceCloseRequired) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
          return res.status(403).json({
            success: false,
            action: 'FORCE_CLOSE_REASON_REQUIRED', // 傳給前端觸發彈窗
            message: 'Reason is required for force closure.',
          });
        }
      }

      // 其他錯誤處理 (例如真正的權限不足)
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(error.status || 400).json({
          success: false,
          message: error.message,
        });
      }

      // 其他錯誤處理 (例如權限不足)
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(error.status || 400).json({
          success: false,
          message: error.message,
        });
      }

      // 如果是傳統頁面跳轉出錯，可以導回原頁面並帶上錯誤訊息（這部分視你的 flash message 實作而定）
      return res.redirect(
        `/tasks/${id}?error=${encodeURIComponent(error.message)}`,
      );
    }
  }

  @Post(':id/archive')
  async archiveTask(
    @Req() req: Request,
    @GetCurrentUser() user: CurrentUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    await this.tasksService.archiveTask(id, user.userId);
    setSession(req, 'success', 'Task has been archived.');
    return res.redirect(`/tasks/${id}`);
  }

  @Post(':id/restore')
  async restoreTask(
    @Req() req: Request,
    @GetCurrentUser() user: CurrentUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    await this.tasksService.restoreTask(id, user.userId);
    setSession(req, 'success', 'Task has been restored.');
    return res.redirect(`/tasks/${id}`);
  }

  // ---------------- notification ----------------

  @Get('notifications')
  @UseInterceptors(new SerializationInterceptor(NotificationDto))
  async getNotifications(@Req() req, @GetCurrentUser() user: CurrentUser) {
    return await this.tasksService.getPendingNotifications(user.userId);
  }

  // --------------- sub-tasks --------------------

  @Post(':id/sub-tasks')
  async addSubTask(
    @Req() req: Request,
    @GetCurrentUser() user: CurrentUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubTasksAddDto,
    @Res() res: Response,
  ) {
    const payload: SubTaskAddPayload = {
      title: dto.title,
      status: dto.status ?? null,
      priority: dto.priority ?? null,
      description: dto.description ?? null,
      allDay: dto.allDay,
      dueDate: dto.dueDate ?? null,
      dueTime: dto.dueTime ?? null,
      location: dto.location ?? null,
      parentTaskId: id,
      actorId: user.userId,
      updatedBy: user.userName,
    };
    await this.tasksService.createSubTask(payload);
    setSession(req, 'success', 'Sub-task added');
    return res.redirect(`/tasks/${id}`);
  }

  @Post(':taskId/sub-tasks/:id/close')
  async closeSubTask(
    @Req() req: Request,
    @GetCurrentUser() user: CurrentUser,
    @Param('taskId') taskId: number,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    await this.tasksService.closeSubTask(id, user.userId);
    setSession(req, 'success', 'Sub-task closed.');
    return res.redirect(`/tasks/${taskId}/sub-tasks/${id}`);
  }

  // edit
  @Post(':taskId/sub-tasks/:id/update')
  async updateSubTask(
    @Req() req: Request,
    @Body() dto: UpdateTaskDto,
    @GetCurrentUser() user: CurrentUser,
    @Param('taskId') taskId: number,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    await this.tasksService.updateSubTask(id, user.userId, user.timeZone, dto);
    setSession(req, 'success', 'Sub-task has been updated');
    return res.redirect(`/tasks/${taskId}/sub-tasks/${id}`);
  }

  @Post(':taskId/sub-tasks/:id/restore')
  async restoreSubTask(
    @Req() req: Request,
    @GetCurrentUser() user: CurrentUser,
    @Param('taskId') taskId: number,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    await this.tasksService.restoreSubTask(id);
    setSession(req, 'success', 'Sub-task has been restored.');
    return res.redirect(`/tasks/${taskId}/sub-tasks/${id}`);
  }

  // claim, assignee task status report
  @Post(':taskId/sub-tasks/:id/update/assignee-status')
  async updateSubTaskAssigneeStatus(
    @Req() req: Request,
    @Param('taskId', ParseIntPipe) taskId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAssigneeStatusDto,
    @GetCurrentUser() user: CurrentUser,
    @Res() res: Response,
  ) {
    await this.tasksService.updateSubTaskAssigneeStatus(
      id,
      user.userId,
      dto,
      user.userName,
    );
    setSession(req, 'success', 'Status has been changed.');
    return res.redirect(`/tasks/${taskId}/sub-tasks/${id}`);
  }

  // ----------------- Assign task----------------------
  @Post(':id/assign-task')
  async assignTask(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignTaskDto,
    @GetCurrentUser() user: CurrentUser,
    @Res() res: Response,
  ) {
    const payload: AssignTaskPayload = {
      ...dto,
      id,
      assigneeId: dto.assigneeId,
      assignerName: user.userName,
      assignerId: user.userId,
      updatedBy: user.userName,
    };
    const mailSent = await this.tasksService.assignTask(payload);
    if (!dto.sendUrgentEmail) {
      setSession(req, 'success', 'Task is pending now.');
    } else if (mailSent) {
      setSession(
        req,
        'success',
        'Task is pending now and Email successfully send',
      );
    } else {
      setSession(
        req,
        'warning',
        'Task is pending, but Email not send, please check env variables',
      );
    }

    return res.redirect(`/tasks/${id}`);
  }

  @Post(':taskId/sub-tasks/:id/assign-sub-task')
  async assignSubTask(
    @Req() req: Request,
    @Param('taskId', ParseIntPipe) taskId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignTaskDto,
    @GetCurrentUser() user: CurrentUser,
    @Res() res: Response,
  ) {
    const payload: AssignTaskPayload = {
      ...dto,
      id,
      assigneeId: dto.assigneeId,
      assignerName: user.userName,
      assignerId: user.userId,
      updatedBy: user.userName,
    };
    await this.tasksService.assignSubTask(payload);
    setSession(req, 'success', 'Task is pending now.');
    return res.redirect(`/tasks/${taskId}/sub-tasks/${id}`);
  }

  @Public()
  @Get('assignments/decision')
  async handleAssignmentDecision(
    @Query('token') token: string,
    @Query('status') status: AssignmentStatus,
    @Res() res: Response,
  ) {
    try {
      // 1. 驗證 Token 並更新狀態 (邏輯封裝在 Service)
      const { taskId, subTaskId, accessPayload } =
        await this.tasksService.executeAssignmentDecision(token, status);
      const accessToken =
        await this.securityService.signAccessToken(accessPayload);

      res.cookie(
        'grouptodo_login',
        accessToken,
        this.securityService.getCookieOptions(),
      );

      // 2. 渲染成功頁面，提示使用者已處理完成
      return res.render('tasks/email-response-success', {
        status,
        taskId,
        subTaskId,
        message:
          status === 'ACCEPTED'
            ? 'You have successfully accepted this task!'
            : 'You have rejected this task.',
      });
    } catch (e) {
      // 如果 Token 過期或無效，顯示錯誤頁面
      return res.render('tasks/email-response-error', {
        error:
          'The link is invalid or broken. Please log in to the system to handle it manually.',
      });
    }
  }
}
