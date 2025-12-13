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
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AccessTokenGuard } from 'src/auth/guards/access-token.guard';
import { CurrentUserDecorator } from 'src/common/decorators/user.decorator';
import { CurrentUser } from 'src/common/types/current-user';
import {
  SubTasksAddDto,
  TasksAddDto,
  UpdateAssigneeStatusDto,
  UpdateTaskDto,
} from './dto/tasks.dto';
import { TasksService } from './tasks.service';
import { SubTaskAddPayload, TasksAddPayload } from './types/tasks';
import { setSession } from 'src/common/helpers/flash-helper';
import { TasksPageFilter } from 'src/common/filters/tasks-page.filter';
import { SubTask, Task } from 'src/generated/prisma/client';

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
  @Post(':id/update/assignee-status')
  async updateAssigneeStatus(
    @Req() req: Request,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAssigneeStatusDto,
    @CurrentUserDecorator() user: CurrentUser,
    @Res() res: Response,
  ) {
    await this.tasksService.updateAssigneeStatus(id, user.userId, dto);
    setSession(req, 'success', 'Status has been changed.');
    return res.redirect('/tasks/home');
  }

  @Post(':id/close')
  async closeTask(
    @Req() req: Request,
    @CurrentUserDecorator() user: CurrentUser,
    @Param('id', ParseIntPipe) id: number,
    @Body('force') forceRaw: string | undefined,
    @Body('closedReason') reasonRaw: string | undefined,
    @Res() res: Response,
  ) {
    // 1) 正規化表單欄位
    const force =
      forceRaw === '1' || forceRaw === 'true' || forceRaw === 'on'
        ? true
        : false;

    const reason = (reasonRaw ?? '').trim() || undefined;

    await this.tasksService.closeTask(id, user.userId, { force, reason });

    // 3) 回頁面（可帶 flash
    setSession(req, 'success', 'Task closed.');
    return res.redirect(`/tasks/${id}`);
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
    await this.tasksService.restoreTask(id, user.userId);
    setSession(req, 'success', 'Task has been restored.');
    return res.redirect('/tasks/home');
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

  @Post(':id/subtasks')
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
    };
    await this.tasksService.createSubTask(payload);
    setSession(req, 'success', 'Sub-task added');
    return res.redirect(`/tasks/${id}`);
  }
}
