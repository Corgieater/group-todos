import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UsersService } from 'src/users/users.service';
import { TasksAddPayload } from './types/tasks';
import { Status, User as UserModel, Task as TaskModel } from '@prisma/client';
import { UsersErrors } from 'src/errors';
import { TaskPriority } from './types/enum';
import { TasksErrors } from 'src/errors';

@Injectable()
export class TasksService {
  constructor(
    private prismaService: PrismaService,
    private usersService: UsersService,
  ) {}

  async addTask(payload: TasksAddPayload): Promise<void> {
    const user = await this.usersService.findByIdOrThrow(payload.userId);

    const data = {
      title: payload.title,
      description: payload.description,
      dueAt: payload.dueAt ? new Date(payload.dueAt) : null,
      allDay: payload.dueAt ? !payload.dueAt.includes('T') : false,
      location: payload.location,
      userId: user.id,
    };
    if (payload.status) {
      data['status'] = payload.status;
    }
    if (payload.priority) {
      data['priority'] = payload.priority;
    }

    await this.prismaService.task.create({ data });
  }

  async getAllTasks(userId: number): Promise<TaskModel[]> {
    await this.usersService.findByIdOrThrow(userId);

    return this.prismaService.task.findMany({
      where: { userId, status: Status.UNFINISHED },
      orderBy: { priority: 'asc' },
    });
  }

  async getTaskById(userId: number, taskId: number): Promise<TaskModel> {
    await this.usersService.findByIdOrThrow(userId);

    const task = await this.prismaService.task.findUnique({
      where: { userId, id: taskId },
    });
    if (!task) {
      throw TasksErrors.TaskNotFoundError.byId(userId, taskId);
    }

    return task;
  }

  async updateTaskById(userId: number, taskId: number) {}
}
