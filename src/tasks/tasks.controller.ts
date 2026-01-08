import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UseGuards,
  UseFilters,
  Get,
  Query,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AccessTokenGuard } from 'src/auth/guards/access-token.guard';
import { CurrentUserDecorator } from 'src/common/decorators/user.decorator';
import { CurrentUser } from 'src/common/types/current-user';
import {
  AssignTaskDto,
  SubTasksAddDto,
  TasksAddDto,
  UpdateAssigneeStatusDto,
  UpdateTaskDto,
} from './dto/tasks.dto';
import { TasksService } from './tasks.service';
import {
  AssignTaskPayload,
  SubTaskAddPayload,
  TasksAddPayload,
} from './types/tasks';
import { setSession } from 'src/common/helpers/flash-helper';
import { TasksPageFilter } from 'src/common/filters/tasks-page.filter';
import { Public } from 'src/common/decorators/public.decorator';
import { AssignmentStatus } from 'src/generated/prisma/enums';

@Controller('api/tasks')
@UseGuards(AccessTokenGuard)
@UseFilters(TasksPageFilter)
export class TasksController {
  constructor(private tasksService: TasksService) {}

  @Post()
  async create(
    @Req() req: Request,
    @CurrentUserDecorator() user: CurrentUser,
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

  // NOTE:
  // Currently allowed empty data update,
  // once frontend been separated, we can check by frontend
  @Post(':id/update')
  async update(
    @Req() req: Request,
    @Body() dto: UpdateTaskDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const task = await this.tasksService.updateTask(id, user.userId, dto);
    setSession(req, 'success', 'Task has been updated');
    return res.redirect(`/tasks/${task.id}`);
  }

  // NOTE:
  // Maybe there will be more status in the future
  // I think this api should deal with update assignessTask status
  // self-assign, claim, 指派任務
  @Post(':id/update/assignee-status')
  async updateAssigneeStatus(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAssigneeStatusDto,
    @CurrentUserDecorator() user: CurrentUser,
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
    @Body() body: { reason?: string }, // 👈 必須有這行，Nest 才能從 body 抓資料
    @CurrentUserDecorator() user: CurrentUser,
  ) {
    return this.tasksService.closeTask(id, user.userId, {
      reason: body.reason,
    });
  }

  @Post(':id/archive')
  async archiveTask(
    @Req() req: Request,
    @CurrentUserDecorator() user: CurrentUser,
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
    @CurrentUserDecorator() user: CurrentUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    await this.tasksService.restoreTask(id);
    setSession(req, 'success', 'Task has been restored.');
    return res.redirect(`/tasks/${id}`);
  }

  //NOTE:
  // 1. We use pug, so we use Post instead of delete
  // 2. Currently we don't warm user when task deleting .
  // Add this when frontend separated
  // Currently not implement
  @Post(':id/delete')
  async delete(
    @Req() req: Request,
    @CurrentUserDecorator() user: CurrentUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    await this.tasksService.deleteTask(id, user.userId);
    setSession(req, 'success', 'Task has been deleted.');
    return res.redirect('/tasks/home');
  }

  // ---------------- notification ----------------

  @Get('notifications')
  async getNotifications(
    @Req() req,
    @CurrentUserDecorator() user: CurrentUser,
  ) {
    return await this.tasksService.getPendingNotifications(user.userId);
  }

  // --------------- sub-tasks --------------------

  @Post(':id/sub-tasks')
  async addSubTask(
    @Req() req: Request,
    @CurrentUserDecorator() user: CurrentUser,
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
    @CurrentUserDecorator() user: CurrentUser,
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
    @CurrentUserDecorator() user: CurrentUser,
    @Param('taskId') taskId: number,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const subTask = await this.tasksService.updateSubTask(id, user.userId, dto);
    setSession(req, 'success', 'Sub-task has been updated');
    return res.redirect(`/tasks/${taskId}/sub-tasks/${subTask.id}`);
  }

  @Post(':taskId/sub-tasks/:id/restore')
  async restoreSubTask(
    @Req() req: Request,
    @CurrentUserDecorator() user: CurrentUser,
    @Param('taskId') taskId: number,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    await this.tasksService.restoreSubTask(id);
    setSession(req, 'success', 'Sub-task has been restored.');
    return res.redirect(`/tasks/${taskId}/sub-tasks/${id}`);
  }

  // claim
  @Post(':taskId/sub-tasks/:id/update/assignee-status')
  async updateSubTaskAssigneeStatus(
    @Req() req: Request,
    @Param('taskId', ParseIntPipe) taskId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAssigneeStatusDto,
    @CurrentUserDecorator() user: CurrentUser,
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
    @CurrentUserDecorator() user: CurrentUser,
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
    await this.tasksService.assignTask(payload);
    setSession(req, 'success', 'Task is pending now.');
    return res.redirect(`/tasks/${id}`);
  }

  @Post(':taskId/sub-task/:id/assign-sub-task')
  async assignSubTask(
    @Req() req: Request,
    @Param('taskId', ParseIntPipe) taskId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignTaskDto,
    @CurrentUserDecorator() user: CurrentUser,
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
  @Get('respond-from-email')
  async respondFromEmail(
    @Query('token') token: string,
    @Query('status') status: AssignmentStatus,
    @Res() res: Response,
  ) {
    try {
      // 1. 驗證 Token 並更新狀態 (邏輯封裝在 Service)
      const { taskId, subTaskId } =
        await this.tasksService.processEmailResponse(token, status);

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
