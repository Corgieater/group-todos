import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UsersService } from 'src/users/users.service';
import { TasksAddPayload, TaskUpdatePayload } from './types/tasks';
import { Prisma, Task as TaskModel } from '@prisma/client';
import { TaskStatus } from './types/enum';
import { GroupsErrors, TasksErrors } from 'src/errors';
import { dayBoundsUtc } from 'src/common/helpers/util';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

type DueFilter = 'TODAY' | 'NONE' | 'EXPIRED' | 'RANGE';

type ListTasksScope =
  | { kind: 'owner'; ownerId: number }
  | { kind: 'group'; groupId: number; viewerId: number };

type ListTasksFilters = {
  status?: TaskStatus[]; // 預設 ['UNFINISHED']
  due?: DueFilter[]; // 例：['TODAY','NONE'] / ['EXPIRED']
  range?: { startUtc: Date; endUtc: Date }; // 當 due 包含 'RANGE' 時使用
};

type OrderKey = 'dueAtAscNullsLast' | 'createdAsc' | 'expiredPriority';

@Injectable()
export class TasksService {
  constructor(
    private prismaService: PrismaService,
    private usersService: UsersService,
  ) {}

  async createTask(
    payload: TasksAddPayload,
    groupId: number | null = null,
  ): Promise<void> {
    const user = await this.usersService.findByIdOrThrow(payload.userId);
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
    if (groupId) {
      data['groupId'] = groupId;
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
    const { items } = await this.listTaskCore(
      { kind: 'owner', ownerId },
      { status: [status] },
      'createdAsc',
    );
    return items;
  }

  async listOpenTasksDueTodayNoneOrExpired(ownerId: number): Promise<{
    items: TaskModel[];
    bounds: {
      timeZone: string;
      startUtc: Date;
      endUtc: Date;
      startOfTodayUtc: Date;
      todayDateOnlyUtc: Date;
    };
  }> {
    return await this.listTaskCore(
      { kind: 'owner', ownerId },
      { status: ['UNFINISHED'], due: ['TODAY', 'NONE', 'EXPIRED'] },
      'createdAsc',
    );
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
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw TasksErrors.TaskNotFoundError.byId(userId, id);
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

  async listGroupOpenTasksDueTodayNoneOrExpired(
    groupId: number,
    userId: number,
  ) {
    return await this.listTaskCore(
      { kind: 'group', groupId, viewerId: userId },
      { status: ['UNFINISHED'], due: ['TODAY', 'NONE', 'EXPIRED'] },
      'createdAsc',
    );
  }

  private async listTaskCore(
    scope: ListTasksScope,
    filters: ListTasksFilters,
    orderByKey: OrderKey,
  ) {
    let timeZone!: string;

    if (scope.kind === 'owner') {
      const user = await this.usersService.findByIdOrThrow(scope.ownerId);
      timeZone = user.timeZone ?? 'UTC';
    } else {
      const member = await this.prismaService.groupMember.findFirst({
        where: { groupId: scope.groupId, userId: scope.viewerId },
        include: { user: { select: { timeZone: true } } },
      });
      if (!member)
        throw GroupsErrors.GroupNotFoundError.byId(
          scope.viewerId,
          scope.groupId,
        );
      timeZone = member.user.timeZone ?? 'UTC';
    }

    const status = filters.status ?? ['UNFINISHED'];
    const due = new Set(filters.due ?? []);
    const OR: Prisma.TaskWhereInput[] = [];

    const { startUtc, endUtc } = dayBoundsUtc(timeZone);
    const todayStr = formatInTimeZone(new Date(), timeZone, 'yyyy-MM-dd');
    const todayDateOnlyUtc = new Date(`${todayStr}T00:00:00.000Z`);

    const today = formatInTimeZone(new Date(), timeZone, 'yyyy-MM-dd');
    const startOfTodayUtc = fromZonedTime(`${today}T00:00:00`, timeZone);
    if (due.has('NONE')) OR.push({ dueAtUtc: null });
    if (due.has('TODAY')) {
      OR.push(
        { dueAtUtc: { gte: startUtc, lte: endUtc } },
        { allDayLocalDate: { equals: todayDateOnlyUtc } },
      );
    }
    if (due.has('EXPIRED')) {
      const dateOnlyCutoff = new Date(`${today}T00:00:00.000Z`);
      OR.push(
        { dueAtUtc: { not: null, lt: startOfTodayUtc } },
        { allDayLocalDate: { not: null, lt: dateOnlyCutoff } },
      );
    }
    if (due.has('RANGE') && filters.range) {
      OR.push({
        dueAtUtc: { gte: filters.range.startUtc, lte: filters.range.endUtc },
      });
    }

    const where: Prisma.TaskWhereInput =
      scope.kind === 'owner'
        ? {
            ownerId: scope.ownerId,
            status: { in: status },
            ...(OR.length ? { OR } : {}),
          }
        : {
            groupId: scope.groupId,
            status: { in: status },
            ...(OR.length ? { OR } : {}),
          };

    const orderBy =
      orderByKey === 'dueAtAscNullsLast'
        ? ([
            { dueAtUtc: { sort: 'asc', nulls: 'last' } },
            { createdAt: 'asc' },
          ] satisfies Prisma.TaskOrderByWithRelationInput[])
        : orderByKey === 'expiredPriority'
          ? ([
              { allDay: 'desc' },
              { allDayLocalDate: 'asc' },
              { dueAtUtc: 'asc' },
            ] satisfies Prisma.TaskOrderByWithRelationInput[])
          : ([
              { createdAt: 'asc' },
            ] satisfies Prisma.TaskOrderByWithRelationInput[]);

    const items = await this.prismaService.task.findMany({ where, orderBy });

    return {
      items,
      bounds: { timeZone, startUtc, endUtc, startOfTodayUtc, todayDateOnlyUtc },
    };
  }
}
