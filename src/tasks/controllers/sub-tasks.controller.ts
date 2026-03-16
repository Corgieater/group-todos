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
  UseGuards,
  SetMetadata,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { GetCurrentUser } from 'src/common/decorators/user.decorator';
import { CurrentUser } from 'src/common/types/current-user';
import {
  AssignTaskDto,
  SubTasksAddDto,
  UpdateAssigneeStatusDto,
  UpdateTaskDto,
} from '../dto/tasks.dto';
import {
  AssignTaskPayload,
  SubTaskAddPayload,
  TaskContext,
} from '../types/tasks';
import { setSession } from 'src/common/helpers/flash-helper';
import { TasksPageFilter } from 'src/common/filters/tasks-page.filter';
import { Public } from 'src/common/decorators/public.decorator';
import { AssignmentStatus } from 'src/generated/prisma/enums';
import { SecurityService } from 'src/security/security.service';
import { SubTasksService } from '../services/sub-tasks.service';
import { TaskAssignmentManager } from '../services/task-assignment.service';
import { TaskMemberGuard } from '../guard/task-member.guard';
import { GetTaskContext } from 'src/tasks/decorators/task-context.decorator';
import { SubTaskExistsGuard } from '../guard/sub-task-exists.guard';
import { GetSubTaskContext } from '../decorators/sub-task-context.decorator';
import { SubTask } from 'src/generated/prisma/client';

@Controller('api/tasks/:taskId/sub-tasks')
@UseFilters(TasksPageFilter)
export class SubTasksController {
  constructor(
    private readonly subTasksService: SubTasksService,
    private readonly securityService: SecurityService,
    private readonly taskAssignmentManager: TaskAssignmentManager,
  ) {}

  @Post('')
  @SetMetadata('taskParamName', 'taskId')
  @UseGuards(TaskMemberGuard)
  async create(
    @Req() req: Request,
    @GetCurrentUser() user: CurrentUser,
    @GetTaskContext() taskCtx: TaskContext,
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
      parentTaskId: taskCtx.task.id,
      actorId: user.userId,
      updatedBy: user.userName,
      timeZone: user.timeZone,
    };
    await this.subTasksService.createSubTask(payload);
    setSession(req, 'success', 'Sub-task added');
    return res.redirect(`/tasks/${taskCtx.task.id}`);
  }

  @Post(':id/close')
  async close(
    @Req() req: Request,
    @GetCurrentUser() user: CurrentUser,
    @Param('taskId') taskId: number,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    await this.subTasksService.closeSubTask(id, user.userId);
    setSession(req, 'success', 'Sub-task closed.');
    return res.redirect(`/tasks/${taskId}/sub-tasks/${id}`);
  }

  // edit
  @Post(':id/update')
  @SetMetadata('taskParamName', 'taskId')
  @UseGuards(TaskMemberGuard)
  @UseGuards(SubTaskExistsGuard)
  async update(
    @Req() req: Request,
    @Body() dto: UpdateTaskDto,
    @GetCurrentUser() user: CurrentUser,
    @GetTaskContext() taskCtx: TaskContext,
    @GetSubTaskContext() subTask: SubTask,
    @Res()
    res: Response,
  ) {
    await this.subTasksService.updateSubTask(
      subTask.id,
      user.userId,
      user.timeZone,
      dto,
    );
    setSession(req, 'success', 'Sub-task has been updated');
    return res.redirect(`/tasks/${taskCtx.task.id}/sub-tasks/${subTask.id}`);
  }

  @Post(':id/restore')
  @SetMetadata('taskParamName', 'taskId')
  @UseGuards(TaskMemberGuard)
  @UseGuards(SubTaskExistsGuard)
  async restoreSubTask(
    @Req() req: Request,
    @GetTaskContext() taskCtx: TaskContext,
    @GetSubTaskContext() subTask: SubTask,
    @Res() res: Response,
  ) {
    await this.subTasksService.restoreSubTask(subTask.id);
    setSession(req, 'success', 'Sub-task has been restored.');
    return res.redirect(`/tasks/${taskCtx.task.id}/sub-tasks/${subTask.id}`);
  }

  // claim, assignee task status report
  @Post(':id/update/assignee-status')
  @SetMetadata('taskParamName', 'taskId')
  @UseGuards(TaskMemberGuard)
  @UseGuards(SubTaskExistsGuard)
  async updateSubTaskAssigneeStatus(
    @Req() req: Request,
    @GetTaskContext() taskCtx: TaskContext,
    @GetSubTaskContext() subTask: SubTask,
    @Body() dto: UpdateAssigneeStatusDto,
    @GetCurrentUser() user: CurrentUser,
    @Res() res: Response,
  ) {
    await this.subTasksService.updateSubTaskAssigneeStatus(
      subTask.id,
      user.userId,
      dto,
      user.userName,
    );
    setSession(req, 'success', 'Status has been changed.');
    return res.redirect(`/tasks/${taskCtx.task.id}/sub-tasks/${subTask.id}`);
  }

  // ----------------- Assign task----------------------

  @Post(':id/assign-sub-task')
  @SetMetadata('taskParamName', 'taskId')
  @UseGuards(TaskMemberGuard)
  @UseGuards(SubTaskExistsGuard)
  async assignSubTask(
    @Req() req: Request,
    @GetTaskContext() taskCtx: TaskContext,
    @GetSubTaskContext() subTask: SubTask,
    @Body() dto: AssignTaskDto,
    @GetCurrentUser() user: CurrentUser,
    @Res() res: Response,
  ) {
    const payload: AssignTaskPayload = {
      ...dto,
      id: subTask.id,
      assigneeId: dto.assigneeId,
      assignerName: user.userName,
      assignerId: user.userId,
    };
    await this.subTasksService.assignSubTask(payload);
    setSession(req, 'success', 'Task is pending now.');
    return res.redirect(`/tasks/${taskCtx.task.id}/sub-tasks/${subTask.id}`);
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
        await this.taskAssignmentManager.executeDecision(token, status);
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
