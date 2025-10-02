import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { User as Usermodel, Task as TaskModel } from '@prisma/client';
import { TaskStatus } from './types/enum';
import { TasksService } from './tasks.service';
import { UsersService } from 'src/users/users.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { TasksAddPayload, TaskUpdatePayload } from './types/tasks';
import { TaskPriority } from './types/enum';
import { TasksErrors, UsersErrors } from 'src/errors';
import { createMockUser } from 'src/test/factories/mock-user.factory';
import { createMockTask } from 'src/test/factories/mock-task.factory';
import * as Time from 'src/common/helpers/util';

describe('TasksService', () => {
  let tasksService: TasksService;

  const mockUsersService = { findByIdOrThrow: jest.fn() };
  const mockPrismaService = {
    $queryRaw: jest.fn(),
    task: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  const user: Usermodel = createMockUser();
  const lowTask: TaskModel = createMockTask();
  const mediumTask: TaskModel = createMockTask({
    id: 2,
    title: 'medium test',
    priority: TaskPriority.MEDIUM,
  });
  const urgentTask: TaskModel = createMockTask({
    id: 3,
    title: 'urgent test',
    priority: TaskPriority.URGENT,
  });

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    tasksService = module.get<TasksService>(TasksService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUsersService.findByIdOrThrow.mockResolvedValue(user);
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // createTask
  // ───────────────────────────────────────────────────────────────────────────────

  describe('createTask', () => {
    let payload: TasksAddPayload;

    beforeEach(() => {
      payload = {
        title: 'task1',
        status: null,
        priority: null,
        description: null,
        dueDate: '2025-09-09',
        allDay: true,
        dueTime: null,
        location: null,
        userId: user.id,
      };

      mockPrismaService.task.create.mockResolvedValue({
        id: 1,
        ...payload,
        allDay: false,
      } as any);
    });

    it('creates an all-day task with defaults when optionals are null', async () => {
      await tasksService.createTask(payload);

      expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(1);
      expect(mockPrismaService.task.create).toHaveBeenCalled();

      const [{ data }] = mockPrismaService.task.create.mock.calls[0];

      expect(data).toMatchObject({
        title: 'task1',
        description: null,
        dueAtUtc: null,
        allDayLocalDate: new Date('2025-09-09T00:00:00.000Z'),
        allDay: true,
        location: null,
        ownerId: 1,
      });

      expect(Object.keys(data)).toEqual(
        expect.arrayContaining([
          'title',
          'description',
          'dueAtUtc',
          'allDay',
          'location',
          'allDayLocalDate',
          'ownerId',
        ]),
      );
    });

    it('creates a timed task (dueDate+dueTime→dueAtUtc) and applies status/priority', async () => {
      payload.allDay = false;
      payload.dueTime = '10:10';
      payload.status = TaskStatus.FINISHED;
      payload.priority = TaskPriority.HIGH;

      await tasksService.createTask(payload);

      const [{ data }] = mockPrismaService.task.create.mock.calls[0];

      expect(data.dueAtUtc).toBeInstanceOf(Date);
      expect((data.dueAtUtc as Date).toISOString()).toBe(
        '2025-09-09T02:10:00.000Z',
      );

      expect(data).toMatchObject({
        status: TaskStatus.FINISHED,
        priority: TaskPriority.HIGH,
        allDay: false,
        dueAtUtc: new Date('2025-09-09T02:10:00.000Z'),
      });
    });

    it('should not hit database when user not found', async () => {
      payload = {
        ...payload,
        userId: 999,
      };
      mockUsersService.findByIdOrThrow.mockRejectedValueOnce(
        UsersErrors.UserNotFoundError.byId(999),
      );

      await expect(tasksService.createTask(payload)).rejects.toBeInstanceOf(
        UsersErrors.UserNotFoundError,
      );

      expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(999);
      expect(mockPrismaService.task.create).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // getAllFutureTasks
  // ───────────────────────────────────────────────────────────────────────────────

  describe('getAllFutureTasks', () => {
    const startUtc = new Date('2025-09-01T00:00:00.000Z');
    const endUtc = new Date('2025-09-01T23:59:59.999Z');

    beforeEach(() => {
      jest.spyOn(Time, 'dayBoundsUtc').mockReturnValue({ startUtc, endUtc });
    });

    it('returns unfinished future tasks', async () => {
      const rows = [{ id: 1 }, { id: 2 }];
      mockPrismaService.$queryRaw.mockResolvedValueOnce(rows);

      const tasks = await tasksService.getAllFutureTasks(
        user.id,
        user.timeZone,
      );

      expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(1);
      expect(mockPrismaService.$queryRaw).toHaveBeenCalledTimes(1);

      expect(tasks).toBe(rows);
    });

    it('should not hit database when user not found', async () => {
      mockUsersService.findByIdOrThrow.mockRejectedValueOnce(
        UsersErrors.UserNotFoundError.byId(999),
      );

      await expect(
        tasksService.getAllFutureTasks(999, 'Asia/Taipei'),
      ).rejects.toBeInstanceOf(UsersErrors.UserNotFoundError);

      expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(999);
      expect(mockPrismaService.task.findMany).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // getTaskById
  // ───────────────────────────────────────────────────────────────────────────────

  describe('getTaskById', () => {
    it('returns task details by id', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(lowTask);

      const task = await tasksService.getTaskById(lowTask.id, user.id);

      expect(mockPrismaService.task.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1, ownerId: 1 } }),
      );

      expect(task).toMatchObject({
        id: lowTask.id,
        title: 'low test',
        status: TaskStatus.UNFINISHED,
        priority: TaskPriority.LOW,
        location: 'test',
        description: 'test',
        dueAtUtc: null,
      });

      expect(task.createdAt).toBeInstanceOf(Date);
      expect(task.createdAt.toISOString()).toBe('2025-09-01T05:49:55.797Z');
    });

    it('throws TaskNotFoundError if task id not found', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(null);

      await expect(
        tasksService.getTaskById(999, user.id),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);
    });

    it('should not hit database if user not found', async () => {
      mockUsersService.findByIdOrThrow.mockRejectedValueOnce(
        UsersErrors.UserNotFoundError.byId(999),
      );

      await expect(
        tasksService.getTaskById(lowTask.id, 999),
      ).rejects.toBeInstanceOf(UsersErrors.UserNotFoundError);

      expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(999);
      expect(mockPrismaService.task.findUnique).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // getTasksByStatus
  // ───────────────────────────────────────────────────────────────────────────────

  describe('getTasksByStatus', () => {
    let finishedTask1: TaskModel;
    let finishedTask2: TaskModel;

    beforeEach(() => {
      finishedTask1 = { ...lowTask, status: TaskStatus.FINISHED };
      finishedTask2 = { ...mediumTask, status: TaskStatus.FINISHED };
    });

    it('returns tasks by status', async () => {
      mockPrismaService.task.findMany.mockResolvedValueOnce([
        finishedTask1,
        finishedTask2,
      ]);

      const tasks = await tasksService.getTasksByStatus(
        user.id,
        TaskStatus.FINISHED,
      );

      expect(mockPrismaService.task.findMany).toHaveBeenCalledWith({
        where: { ownerId: 1, status: TaskStatus.FINISHED },
      });
      expect(mockPrismaService.task.findMany).toHaveBeenCalledTimes(1);

      expect(tasks).toHaveLength(2);
      expect(tasks.every((t) => t.ownerId === 1)).toBe(true);
      expect(tasks.every((t) => t.status === TaskStatus.FINISHED)).toBe(true);
    });

    it('returns empty array if none', async () => {
      mockPrismaService.task.findMany.mockResolvedValueOnce([]);
      const tasks = await tasksService.getTasksByStatus(
        user.id,
        TaskStatus.FINISHED,
      );
      expect(tasks).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // getUnfinishedTasksTodayOrNoDueDate
  // ───────────────────────────────────────────────────────────────────────────────

  describe('getUnfinishedTasksTodayOrNoDueDate', () => {
    const startUtc = new Date('2025-02-01T00:00:00.000Z');
    const endUtc = new Date('2025-02-01T23:59:59.999Z');
    const today = {
      ...lowTask,
      dueAtUtc: new Date('2025-02-01T10:00:00.000Z'),
    };

    beforeEach(() => {
      jest.spyOn(Time, 'dayBoundsUtc').mockReturnValue({ startUtc, endUtc });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should queries unfinished tasks due today OR undated, ordered by dueAtUtc asc then createdAt', async () => {
      const prismaReturn = [today, lowTask];
      mockPrismaService.task.findMany.mockResolvedValueOnce(prismaReturn);

      const result = await tasksService.getUnfinishedTasksTodayOrNoDueDate(
        user.id,
      );

      expect(Time.dayBoundsUtc).toHaveBeenCalledWith('Asia/Taipei');

      expect(mockPrismaService.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ownerId: 1,
            status: 'UNFINISHED',
            OR: expect.arrayContaining([
              { dueAtUtc: null, allDayLocalDate: null },
              { dueAtUtc: { gte: startUtc, lte: endUtc } },
            ]),
          }),
          orderBy: expect.arrayContaining([
            expect.objectContaining({
              dueAtUtc: expect.objectContaining({ sort: 'asc', nulls: 'last' }),
            }),
            { createdAt: 'asc' },
          ]),
        }),
      );

      expect(result).toBe(prismaReturn);
    });

    it('should not hit database if user not found', async () => {
      mockUsersService.findByIdOrThrow.mockRejectedValueOnce(
        UsersErrors.UserNotFoundError.byId(999),
      );

      await expect(
        tasksService.getUnfinishedTasksTodayOrNoDueDate(999),
      ).rejects.toBeInstanceOf(UsersErrors.UserNotFoundError);

      expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(999);
      expect(mockPrismaService.task.findMany).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // getExpiredTasks
  // ───────────────────────────────────────────────────────────────────────────────

  describe('getExpiredTasks', () => {
    beforeAll(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    });
    afterAll(() => {
      jest.useRealTimers();
    });

    it('should returns expired tasks with expected cutoffs', async () => {
      await tasksService.getExpiredTasks(user.id);

      const { where } = mockPrismaService.task.findMany.mock.calls[0][0];
      const instantCutoff = where.OR.find((c: any) => c.dueAtUtc)?.dueAtUtc.lt;
      const dateOnlyCutoff = where.OR.find((c: any) => c.allDayLocalDate)
        ?.allDayLocalDate.lt;

      const now = new Date('2026-01-01T00:00:00.000Z');
      expect(instantCutoff.getTime()).toBeLessThan(now.getTime());
      expect(dateOnlyCutoff.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('should not hit database if user not found', async () => {
      mockUsersService.findByIdOrThrow.mockRejectedValueOnce(
        UsersErrors.UserNotFoundError.byId(999),
      );

      await expect(tasksService.getExpiredTasks(999)).rejects.toBeInstanceOf(
        UsersErrors.UserNotFoundError,
      );

      expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(999);
      expect(mockPrismaService.task.findMany).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // updateTask
  // ───────────────────────────────────────────────────────────────────────────────

  describe('updateTask', () => {
    const payload: TaskUpdatePayload = {
      title: 'walk cat',
      description: 'walk your cat',
      location: 'london park',
      priority: TaskPriority.HIGH,
      allDay: false,
      dueDate: '2025-09-01',
      dueTime: '13:50',
    };

    it('should updates a non all-day task', async () => {
      mockUsersService.findByIdOrThrow.mockResolvedValueOnce(user);

      await tasksService.updateTask(lowTask.id, user.id, payload);

      expect(mockPrismaService.task.update).toHaveBeenCalledTimes(1);
      const [{ data, where }] = mockPrismaService.task.update.mock.calls[0];

      expect(where).toEqual({ id: lowTask.id, ownerId: user.id });

      expect(data).toMatchObject({
        title: 'walk cat',
        description: 'walk your cat',
        location: 'london park',
        priority: TaskPriority.HIGH,
        allDay: false,
        allDayLocalDate: null,
      });

      expect(Object.keys(data)).not.toEqual(
        expect.arrayContaining(['ownerId']),
      );
    });

    it('should updates an all-day task', async () => {
      const allDayPayload: TaskUpdatePayload = { ...payload, allDay: true };

      mockUsersService.findByIdOrThrow.mockResolvedValueOnce(user);
      await tasksService.updateTask(lowTask.id, user.id, allDayPayload);

      expect(mockPrismaService.task.update).toHaveBeenCalledTimes(1);
      const [{ data, where }] = mockPrismaService.task.update.mock.calls[0];

      expect(where).toEqual({ id: lowTask.id, ownerId: user.id });

      expect(data).toMatchObject({
        title: 'walk cat',
        description: 'walk your cat',
        location: 'london park',
        priority: TaskPriority.HIGH,
        allDay: true,
        allDayLocalDate: new Date('2025-09-01T00:00:00.000Z'),
      });
    });

    it('should not hit database when user not found', async () => {
      mockUsersService.findByIdOrThrow.mockRejectedValueOnce(
        UsersErrors.UserNotFoundError.byId(999),
      );

      await expect(
        tasksService.updateTask(lowTask.id, 999, payload),
      ).rejects.toBeInstanceOf(UsersErrors.UserNotFoundError);

      expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(999);
      expect(mockPrismaService.task.update).not.toHaveBeenCalled();
    });

    it('should throws TaskNotFoundError', async () => {
      const e = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['id', 'userId'] },
      });
      mockPrismaService.task.update.mockRejectedValueOnce(e);

      await expect(
        tasksService.updateTask(999, user.id, payload),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);

      expect(mockPrismaService.task.update).toHaveBeenCalledTimes(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // updateTaskStatus
  // ───────────────────────────────────────────────────────────────────────────────

  describe('updateTaskStatus', () => {
    it('updates task status', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(lowTask);

      await tasksService.updateTaskStatus(
        lowTask.id,
        user.id,
        TaskStatus.FINISHED,
      );

      expect(mockPrismaService.task.findUnique).toHaveBeenCalledWith({
        where: { id: 1, ownerId: 1 },
      });
      expect(mockPrismaService.task.update).toHaveBeenCalledWith({
        where: { id: 1, ownerId: 1 },
        data: { status: TaskStatus.FINISHED },
      });
    });

    it('throws TaskNotFoundError', async () => {
      mockPrismaService.task.findUnique.mockRejectedValueOnce(
        TasksErrors.TaskNotFoundError.byId(user.id, 999),
      );

      await expect(
        tasksService.updateTaskStatus(999, user.id, TaskStatus.FINISHED),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // deleteTask
  // ───────────────────────────────────────────────────────────────────────────────
  describe('deleteTask', () => {
    it('deletes task', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(lowTask);

      await tasksService.deleteTask(1, user.id);

      expect(mockPrismaService.task.findUnique).toHaveBeenCalledWith({
        where: { id: 1, ownerId: 1 },
      });
      expect(mockPrismaService.task.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    it('throws TaskNotFoundError', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(null);

      await expect(tasksService.deleteTask(1, user.id)).rejects.toBeInstanceOf(
        TasksErrors.TaskNotFoundError,
      );
    });
  });
});
