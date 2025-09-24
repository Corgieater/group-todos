import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UsersService } from 'src/users/users.service';
import { TasksAddPayload, TaskUpdatePayload } from './types/tasks';
import { Prisma, Task as TaskModel } from '@prisma/client';
import { TaskStatus } from './types/enum';
import { TasksErrors } from 'src/errors';
import { dayBoundsUtc } from 'src/common/helpers/util';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

@Injectable()
export class TasksService {
  constructor(
    private prismaService: PrismaService,
    private usersService: UsersService,
  ) {}

  async createTask(payload: TasksAddPayload): Promise<void> {
    const user = await this.usersService.findByIdOrThrow(payload.userId);
    // 組dueAtUtc
    // check if it pass
    let dueAtUtc: Date | null = null;
    let allDayLocalDate: Date | null = null;

    if (payload.allDay) {
      allDayLocalDate = payload.dueDate
        ? new Date(`${payload.dueDate}T00:00:00.000Z`)
        : null;
    } else if (payload.dueDate && payload.dueTime) {
      const localISO = `${payload.dueDate}T${payload.dueTime}:00`;
      dueAtUtc = fromZonedTime(localISO, user.timeZone);
    }
    const data = {
      title: payload.title,
      description: payload.description,
      dueAtUtc: dueAtUtc ? new Date(dueAtUtc) : null,
      allDay: payload.allDay,
      location: payload.location,
      ownerId: user.id,
    };

    if (payload.allDay) {
      data['allDayLocalDate'] = allDayLocalDate;
    } else {
      data['allDayLocalDate'] = null;
    }

    if (dueAtUtc) {
      data['dueAtUtc'] = dueAtUtc;
    }

    if (payload.status) {
      data['status'] = payload.status;
    }
    if (payload.priority) {
      data['priority'] = payload.priority;
    }
    await this.prismaService.task.create({ data });
  }

  async getAllFutureTasks(
    userId: number,
    timeZone: string,
  ): Promise<TaskModel[]> {
    await this.usersService.findByIdOrThrow(userId);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const { startUtc, endUtc: _endUtc } = dayBoundsUtc(timeZone, tomorrow);

    return this.prismaService.$queryRaw<TaskModel[]>`
    SELECT *
    FROM "Task"
    WHERE "ownerId" = ${userId}
      AND "status" = 'UNFINISHED'
      AND (
        "dueAtUtc" > ${startUtc}
        OR "allDayLocalDate" > ${startUtc}
      )
    ORDER BY COALESCE("dueAtUtc", "allDayLocalDate") ASC
  `;
  }

  async getTaskById(taskId: number, ownerId: number): Promise<TaskModel> {
    await this.usersService.findByIdOrThrow(ownerId);

    const task = await this.prismaService.task.findUnique({
      where: { id: taskId, ownerId },
    });
    if (!task) {
      throw TasksErrors.TaskNotFoundError.byId(ownerId, taskId);
    }

    return task;
  }

  async getTasksByStatus(
    ownerId: number,
    status: TaskStatus,
  ): Promise<TaskModel[]> {
    return this.prismaService.task.findMany({
      where: { ownerId, status },
    });
  }

  async getUnfinishedTasksTodayOrNoDueDate(
    ownerId: number,
  ): Promise<TaskModel[]> {
    const user = await this.usersService.findByIdOrThrow(ownerId);
    const { startUtc, endUtc } = dayBoundsUtc(user.timeZone);

    return this.prismaService.task.findMany({
      where: {
        ownerId,
        status: TaskStatus.UNFINISHED,
        OR: [
          { dueAtUtc: null, allDayLocalDate: null },
          { dueAtUtc: { gte: startUtc, lte: endUtc } },
        ],
      },
      orderBy: [
        { dueAtUtc: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'asc' },
      ],
    });
  }

  async getExpiredTasks(userId: number): Promise<TaskModel[]> {
    const user = await this.usersService.findByIdOrThrow(userId);
    const timeZone = user.timeZone ?? 'Asia/Taipei';
    const today = formatInTimeZone(new Date(), timeZone, 'yyyy-MM-dd');
    const startOfTodayUtc = fromZonedTime(`${today}T00:00:00`, timeZone);
    const dateOnlyCutoff = new Date(`${today}T00:00:00.000Z`);

    return this.prismaService.task.findMany({
      where: {
        ownerId: userId,
        status: TaskStatus.UNFINISHED,

        OR: [
          { dueAtUtc: { not: null, lt: startOfTodayUtc } },
          {
            allDayLocalDate: { not: null, lt: dateOnlyCutoff },
          },
        ],
      },
      orderBy: [
        { allDay: 'desc' },
        { allDayLocalDate: 'asc' },
        { dueAtUtc: 'asc' },
      ],
    });
  }

  async updateTask(
    id: number,
    userId: number,
    payload: TaskUpdatePayload,
  ): Promise<TaskModel> {
    const user = await this.usersService.findByIdOrThrow(userId);
    const data: Prisma.TaskUpdateInput = {};

    if (payload['title'] !== undefined) {
      data['title'] = payload.title;
    }
    if (payload['description'] !== undefined) {
      data['description'] = payload.description;
    }
    if (payload['location'] !== undefined) {
      data['location'] = payload.location;
    }
    if (payload['priority'] !== undefined) {
      data['priority'] = payload.priority;
    }

    if (payload.allDay) {
      data['allDay'] = true;
      data['allDayLocalDate'] = payload.dueDate
        ? new Date(`${payload.dueDate}T00:00:00.000Z`)
        : null;
      data['dueAtUtc'] = null;
    } else if (!payload.allDay) {
      if (payload.dueDate && payload.dueTime) {
        data['allDay'] = false;
        const localISO = `${payload.dueDate}T${payload.dueTime}:00`;
        data['dueAtUtc'] = fromZonedTime(localISO, user.timeZone);
        data['allDayLocalDate'] = null;
      }
    }

    try {
      const task = await this.prismaService.task.update({
        where: { id, ownerId: userId },
        data,
      });
      return task;
    } catch (e) {
      if (
        // NOTE:
        // this is for be more friendly to test
        e instanceof Prisma.PrismaClientKnownRequestError ||
        e?.name === 'PrismaClientKnownRequestError'
      ) {
        if (e.code === 'P2025') {
          throw TasksErrors.TaskNotFoundError.byId(userId, id);
        }
      }

      throw e;
    }
  }

  async updateTaskStatus(id: number, userId: number, nextStatus: TaskStatus) {
    await this.getTaskById(id, userId);

    return await this.prismaService.task.update({
      where: { id, ownerId: userId },
      data: { status: nextStatus },
    });
  }

  async deleteTask(id: number, userId: number): Promise<void> {
    const task = await this.prismaService.task.findUnique({
      where: { id, ownerId: userId },
    });
    if (!task) {
      throw TasksErrors.TaskNotFoundError.byId(userId, id);
    }

    await this.prismaService.task.delete({ where: { id: task.id } });
  }
}
