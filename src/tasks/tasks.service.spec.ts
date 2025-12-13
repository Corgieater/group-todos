import { Test, TestingModule } from '@nestjs/testing';
import {
  AssignmentStatus,
  GroupRole,
  Prisma,
} from 'src/generated/prisma/client';
import type {
  User as Usermodel,
  Task as TaskModel,
} from 'src/generated/prisma/client';
import { TaskStatus } from './types/enum';
import { TasksService } from './tasks.service';
import { UsersService } from 'src/users/users.service';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  TasksAddPayload,
  TaskUpdatePayload,
  SubTaskAddPayload,
} from './types/tasks';
import { TaskPriority } from './types/enum';
import { TasksErrors, UsersErrors } from 'src/errors';
import { createMockUser } from 'src/test/factories/mock-user.factory';
import { createMockTask } from 'src/test/factories/mock-task.factory';
import * as Time from 'src/common/helpers/util';
import { fromZonedTime } from 'date-fns-tz';

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
    subTask: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    groupMember: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    taskAssignee: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn().mockImplementation(async (cb: any) => {
      const tx = {
        task: mockPrismaService.task,
        groupMember: mockPrismaService.groupMember,
        taskAssignee: mockPrismaService.taskAssignee,
      };
      return cb(tx);
    }),
  };

  const user: Usermodel = createMockUser();
  const lowTask: TaskModel = createMockTask();
  const mediumTask: TaskModel = createMockTask({
    id: 2,
    title: 'medium test',
    priority: TaskPriority.MEDIUM,
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

  const rewireTransaction = () => {
    mockPrismaService.$transaction.mockImplementation(async (cb: any) => {
      const tx = {
        task: mockPrismaService.task,
        groupMember: mockPrismaService.groupMember,
        taskAssignee: mockPrismaService.taskAssignee,
      };
      return cb(tx);
    });
  };

  beforeEach(() => {
    jest.resetAllMocks(); // ⬅️ 清掉實作 + 計數
    jest.restoreAllMocks(); // ⬅️ 還原 spy
    rewireTransaction(); // ⬅️ 重新掛回 $transaction 的實作
    mockUsersService.findByIdOrThrow.mockResolvedValue(createMockUser());
    // jest.clearAllMocks();
    // mockUsersService.findByIdOrThrow.mockResolvedValue(user);
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
      payload.status = TaskStatus.CLOSED;
      payload.priority = TaskPriority.HIGH;

      await tasksService.createTask(payload);

      const [{ data }] = mockPrismaService.task.create.mock.calls[0];

      expect(data.dueAtUtc).toBeInstanceOf(Date);
      expect((data.dueAtUtc as Date).toISOString()).toBe(
        '2025-09-09T02:10:00.000Z',
      );

      expect(data).toMatchObject({
        status: TaskStatus.CLOSED,
        priority: TaskPriority.HIGH,
        allDay: false,
        dueAtUtc: new Date('2025-09-09T02:10:00.000Z'),
      });
    });

    it('should create group task', async () => {
      const groupId = 5;
      await tasksService.createTask(payload, groupId);

      const [{ data }] = mockPrismaService.task.create.mock.calls[0];
      expect(data).toMatchObject({
        title: 'task1',
        description: null,
        dueAtUtc: null,
        allDayLocalDate: new Date('2025-09-09T00:00:00.000Z'),
        allDay: true,
        location: null,
        ownerId: 1,
        groupId: 5,
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
      // Alart: NOTE:
      // this looks suspecious
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
  // getTaskForViewer
  // ───────────────────────────────────────────────────────────────────────────────

  describe('getTaskForViewer', () => {
    it('should return personal task for owner with isAdminish=true', async () => {
      // 第一次：base 查詢（只拿 id/ownerId/groupId）
      mockPrismaService.task.findUnique.mockResolvedValueOnce({
        ...lowTask,
        groupId: null,
      });

      // 第二次：真正載入完整 task（含 assignees）
      mockPrismaService.task.findUnique.mockResolvedValueOnce({
        ...lowTask,
        assignees: [],
      });

      const result = await tasksService.getTaskForViewer(lowTask.id, user.id);

      // 驗證第 1 次呼叫參數
      expect(mockPrismaService.task.findUnique).toHaveBeenNthCalledWith(1, {
        where: { id: 1 },
        select: { id: true, ownerId: true, groupId: true },
      });

      // 驗證第 2 次呼叫參數
      expect(mockPrismaService.task.findUnique).toHaveBeenNthCalledWith(2, {
        where: { id: 1 },
        include: {
          assignees: {
            include: {
              assignee: { select: { id: true, name: true, email: true } },
              assignedBy: { select: { id: true, name: true, email: true } },
            },
            // 如果你在 service 有下 orderBy，就一併驗證
            // orderBy: { acceptedAt: 'asc' },
          },
        },
      });

      expect(result.task.id).toBe(1);
      expect(result.isAdminish).toBe(true);
      expect(result.task.createdAt).toBeInstanceOf(Date);
      expect(result.task.createdAt.toISOString()).toBe(
        '2025-09-01T05:49:55.797Z',
      );
    });

    it('should return group task for ADMIN with isAdminish=true', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce({
        ...lowTask,
        groupId: 2,
      });
      mockPrismaService.task.findUnique.mockResolvedValueOnce({
        ...lowTask,
        groupId: 2,
        assignees: [], // 你 service 的 include 會拿到這個欄位
      });
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.ADMIN,
      });

      const result = await tasksService.getTaskForViewer(1, 8);

      expect(mockPrismaService.groupMember.findUnique).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId: 2, userId: 8 } },
        select: { role: true },
      });
      expect(result.task.id).toBe(1);
      expect(result.isAdminish).toBe(true);
    });

    it('should return group task for MEMBER with isAdminish=false', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce({
        ...lowTask,
        groupId: 2,
      });
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.MEMBER,
      });
      mockPrismaService.task.findUnique.mockResolvedValueOnce({
        ...lowTask,
        assignees: [],
      });

      // finish this
      const res = await tasksService.getTaskForViewer(1, 9);

      expect(res.isAdminish).toBe(false);
    });

    it('throws TaskNotFoundError if task id not found', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(null);

      await expect(
        tasksService.getTaskForViewer(999, user.id),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);
    });

    it('should throw TaskNotFoundError if user does not own this task', async () => {
      await expect(
        tasksService.getTaskForViewer(lowTask.id, 999),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);

      expect(mockPrismaService.task.findUnique).toHaveBeenCalledTimes(1);
    });

    it('should throw TaskNotFoundError when group task and actor is not a member', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce({
        ...lowTask,
        groupId: 2,
      });
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce(null);

      await expect(
        tasksService.getTaskForViewer(1, 999),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // getTasksByStatus
  // ───────────────────────────────────────────────────────────────────────────────

  describe('getTasksByStatus', () => {
    let finishedTask1: TaskModel;
    let finishedTask2: TaskModel;

    beforeEach(() => {
      finishedTask1 = { ...lowTask, status: TaskStatus.CLOSED };
      finishedTask2 = { ...mediumTask, status: TaskStatus.CLOSED };
    });

    it('returns tasks by status', async () => {
      mockPrismaService.task.findMany.mockResolvedValueOnce([
        finishedTask1,
        finishedTask2,
      ]);

      const tasks = await tasksService.getTasksByStatus(
        user.id,
        TaskStatus.CLOSED,
      );

      expect(mockPrismaService.task.findMany).toHaveBeenCalledWith({
        orderBy: [{ createdAt: 'asc' }],
        where: { ownerId: 1, status: { in: ['CLOSED'] }, groupId: null },
        include: {
          assignees: {
            include: {
              assignee: { select: { id: true, name: true, email: true } },
            },
          },
        },
      });
      expect(mockPrismaService.task.findMany).toHaveBeenCalledTimes(1);

      expect(tasks).toHaveLength(2);
      expect(tasks.every((t) => t.ownerId === 1)).toBe(true);
      expect(tasks.every((t) => t.status === TaskStatus.CLOSED)).toBe(true);
    });

    it('returns empty array if none', async () => {
      mockPrismaService.task.findMany.mockResolvedValueOnce([]);
      const tasks = await tasksService.getTasksByStatus(
        user.id,
        TaskStatus.CLOSED,
      );
      expect(tasks).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // listOpenTasksDueTodayNoneOrExpired
  // ───────────────────────────────────────────────────────────────────────────────

  describe('listOpenTasksDueTodayNoneOrExpired', () => {
    const startUtc = new Date('2025-02-01T00:00:00.000Z');
    const endUtc = new Date('2025-02-01T23:59:59.999Z');
    const fixedNow = new Date('2025-02-01T12:00:00.000Z');

    const expectedStartOfTodayUtc = fromZonedTime(
      '2025-02-01T00:00:00',
      'Asia/Taipei',
    );
    const expectedTodayDateOnlyUtc = new Date('2025-02-01T00:00:00.000Z');

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(fixedNow);
      jest.spyOn(Time, 'dayBoundsUtc').mockReturnValue({ startUtc, endUtc });
      mockUsersService.findByIdOrThrow.mockResolvedValue({
        id: 1,
        timeZone: 'Asia/Taipei',
      });
      mockPrismaService.task.findMany.mockResolvedValue([]);
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
      jest.clearAllMocks();
    });

    it('builds correct where/orderBy and returns {items,bounds}', async () => {
      await tasksService.listOpenTasksDueTodayNoneOrExpired(1);

      expect(Time.dayBoundsUtc).toHaveBeenCalledWith('Asia/Taipei');

      expect(mockPrismaService.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ownerId: 1,
            status: { in: ['OPEN'] },
            OR: expect.arrayContaining([
              { dueAtUtc: null },
              { dueAtUtc: { gte: startUtc, lte: endUtc } }, // TODAY timed
              { allDayLocalDate: { equals: expectedTodayDateOnlyUtc } }, // TODAY all-day
              {
                dueAtUtc: expect.objectContaining({
                  not: null,
                  lt: expectedStartOfTodayUtc,
                }),
              }, // EXPIRED timed
              {
                allDayLocalDate: expect.objectContaining({
                  not: null,
                  lt: expectedTodayDateOnlyUtc,
                }),
              }, // EXPIRED all-day
            ]),
          }),
          orderBy: [{ createdAt: 'asc' }],
        }),
      );
    });

    it('should not hit database if user not found', async () => {
      mockUsersService.findByIdOrThrow.mockRejectedValueOnce(
        UsersErrors.UserNotFoundError.byId(999),
      );

      await expect(
        tasksService.listOpenTasksDueTodayNoneOrExpired(999),
      ).rejects.toBeInstanceOf(UsersErrors.UserNotFoundError);

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
  // updateAssigneeStatus
  // ───────────────────────────────────────────────────────────────────────────────

  describe('updateAssigneeStatus', () => {
    const groupTask = { id: 1, groupId: 2, status: TaskStatus.OPEN };
    it('should self-assign (create ACCEPTED) when no existing assignee record', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(groupTask);
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        userId: 1,
      });
      mockPrismaService.taskAssignee.findUnique.mockResolvedValueOnce(null);
      mockPrismaService.taskAssignee.create.mockResolvedValueOnce({ id: 6 });

      await tasksService.updateAssigneeStatus(lowTask.id, user.id, {
        status: AssignmentStatus.ACCEPTED,
      });

      expect(mockPrismaService.task.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: { id: true, groupId: true, status: true },
      });

      expect(mockPrismaService.taskAssignee.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskId: 1,
          assigneeId: 1,
          status: 'ACCEPTED',
          assignedAt: expect.any(Date),
          acceptedAt: expect.any(Date),
        }),
      });
    });

    it('throws TaskNotFoundError', async () => {
      mockPrismaService.task.findUnique.mockRejectedValueOnce(
        TasksErrors.TaskNotFoundError.byId(user.id, 999),
      );

      await expect(
        tasksService.updateAssigneeStatus(999, user.id, {
          status: AssignmentStatus.ACCEPTED,
        }),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // closeTask
  // ───────────────────────────────────────────────────────────────────────────────

  describe('closeTask', () => {
    const personalTask = {
      id: 9,
      ownerId: user.id,
      groupId: null,
      status: TaskStatus.OPEN,
      assignees: [],
    };

    const assignedTaskCompleted = {
      ...personalTask,
      groupId: 11,
      assignees: [{ assigneeId: 2, status: AssignmentStatus.COMPLETED }],
    };

    const assignedTaskWithOneCompleted = {
      ...personalTask,
      groupId: 11,
      assignees: [
        { assigneeId: 2, status: AssignmentStatus.ACCEPTED },
        { assigneeId: 3, status: AssignmentStatus.COMPLETED },
      ],
    };

    const assignedTaskIncompleted = {
      ...personalTask,
      groupId: 11,
      assignees: [{ assigneeId: 2, status: AssignmentStatus.ACCEPTED }],
    };

    it('should close personal task', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(personalTask);

      await tasksService.closeTask(9, user.id);

      expect(mockPrismaService.task.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: {
          status: TaskStatus.CLOSED,
          closedAt: expect.any(Date),
          closedById: 1,
          closedReason: null,
          closedWithOpenAssignees: false,
        },
      });
    });

    it('should close group task with assignee (Owner)', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(
        assignedTaskCompleted,
      );
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.OWNER,
      });

      await tasksService.closeTask(9, user.id);

      expect(mockPrismaService.task.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: {
          status: TaskStatus.CLOSED,
          closedAt: expect.any(Date),
          closedById: 1,
          closedReason: null,
          closedWithOpenAssignees: false,
        },
      });
    });

    it('should close group task with assignees (Adminish)', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(
        assignedTaskCompleted,
      );
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.ADMIN,
      });

      await tasksService.closeTask(9, 3);

      expect(mockPrismaService.task.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: {
          status: TaskStatus.CLOSED,
          closedAt: expect.any(Date),
          closedById: 3,
          closedReason: null,
          closedWithOpenAssignees: false,
        },
      });
    });

    it('should close group task forcefully', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(
        assignedTaskWithOneCompleted,
      );
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.ADMIN,
      });

      await tasksService.closeTask(9, 6, {
        force: true,
      });

      expect(mockPrismaService.task.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: {
          status: TaskStatus.CLOSED,
          closedAt: expect.any(Date),
          closedById: 6,
          closedReason: 'CLOSE_FORCEFULLY',
          closedWithOpenAssignees: true,
        },
      });
    });

    it('should throw TaskNotFoundError', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(null);
      await expect(tasksService.closeTask(9, 6)).rejects.toBeInstanceOf(
        TasksErrors.TaskNotFoundError,
      );
    });

    it('should throw TaskForbiddenError (not member)', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(
        assignedTaskIncompleted,
      );
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce(null);
      await expect(tasksService.closeTask(9, 6)).rejects.toBeInstanceOf(
        TasksErrors.TaskForbiddenError,
      );
    });

    it('should throw TaskForbiddenError (not adminish)', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(
        assignedTaskIncompleted,
      );
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.MEMBER,
      });
      await expect(tasksService.closeTask(9, 6)).rejects.toBeInstanceOf(
        TasksErrors.TaskForbiddenError,
      );
    });

    it('should throw TaskForbiddenError (assignees incomplete)', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(
        assignedTaskIncompleted,
      );
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.ADMIN,
      });

      await expect(tasksService.closeTask(9, 6)).rejects.toBeInstanceOf(
        TasksErrors.TaskForbiddenError,
      );
    });

    it('should throw TaskForbiddenError (partial completed needs force)', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(
        assignedTaskWithOneCompleted,
      );
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.ADMIN,
      });

      await expect(
        tasksService.closeTask(9, 6, {
          force: false,
        }),
      ).rejects.toBeInstanceOf(TasksErrors.TaskForbiddenError);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // closeTask
  // ───────────────────────────────────────────────────────────────────────────────

  describe('archiveTask', () => {
    it('should archive task', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(lowTask);
      await tasksService.archiveTask(1, user.id);

      expect(mockPrismaService.task.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: TaskStatus.ARCHIVED },
      });
    });

    it('should archive group task when adminish', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce({
        ...lowTask,
        ownerId: 8,
        groupId: 1,
      });
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.ADMIN,
      });

      await tasksService.archiveTask(1, user.id);

      expect(mockPrismaService.task.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: TaskStatus.ARCHIVED },
      });
    });

    it('should throw TaskNotFoundError', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(null);

      await expect(
        tasksService.archiveTask(999, user.id),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);
    });

    it('should throw TaskForbiddenError not in the same group', async () => {
      const groupTask = { ...lowTask, ownerId: 6, groupId: 2 };
      mockPrismaService.task.findUnique.mockResolvedValueOnce(groupTask);
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce(null);

      await expect(tasksService.archiveTask(1, user.id)).rejects.toBeInstanceOf(
        TasksErrors.TaskForbiddenError,
      );
    });

    it('should throw TaskForbiddenError not adminish', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce({
        ...lowTask,
        ownerId: 8,
      });
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.MEMBER,
      });

      await expect(tasksService.archiveTask(1, user.id)).rejects.toBeInstanceOf(
        TasksErrors.TaskForbiddenError,
      );
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

  // ───────────────────────────────────────────────────────────────────────────────
  // getUnfinishedTasksTodayOrNoDueDateByGroupId
  // ───────────────────────────────────────────────────────────────────────────────

  describe('listGroupOpenTasksDueTodayNoneOrExpired', () => {
    const startUtc = new Date('2025-09-01T00:00:00.000Z');
    const endUtc = new Date('2025-09-01T23:59:59.999Z');
    const groupId = 1;

    beforeEach(() => {
      jest.spyOn(Time, 'dayBoundsUtc').mockReturnValue({ startUtc, endUtc });
      mockPrismaService.task.findMany.mockResolvedValue([]);
    });

    it('builds correct where/orderBy and returns bounds', async () => {
      mockPrismaService.groupMember.findFirst.mockResolvedValueOnce({
        user: { timeZone: 'Asia/Taipei' },
      });

      const result = await tasksService.listGroupOpenTasksDueTodayNoneOrExpired(
        groupId,
        user.id,
      );

      expect(mockPrismaService.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            groupId: 1,
            status: { in: ['OPEN'] },
            OR: expect.any(Array),
          }),
          orderBy: expect.any(Array),
        }),
      );

      expect(result.bounds).toEqual(
        expect.objectContaining({
          timeZone: expect.any(String),
          startUtc: expect.any(Date),
          endUtc: expect.any(Date),
          startOfTodayUtc: expect.any(Date),
          todayDateOnlyUtc: expect.any(Date),
        }),
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // createSubTask
  // ───────────────────────────────────────────────────────────────────────────────

  describe('createSubTask', () => {
    const payload: SubTaskAddPayload = {
      parentTaskId: lowTask.id,
      actorId: user.id,
      title: 'Sub Task 1',
      status: null,
      priority: null,
      description: null,
      dueDate: '2025-10-10',
      allDay: true,
      dueTime: null,
      location: null,
    };
    const owner = {
      id: user.id,
      timeZone: 'Asia/Taipei',
    };

    const parentTask = { ...lowTask, owner, groupId: null };

    it('creates a personal sub-task linked to parent task', async () => {
      mockPrismaService.task.findUnique.mockResolvedValue(parentTask);
      mockPrismaService.subTask.create.mockResolvedValueOnce({
        id: 100,
        ...payload,
        allDay: true,
      } as any);
      await tasksService.createSubTask(payload);

      expect(mockPrismaService.subTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'Sub Task 1',
          description: null,
          dueAtUtc: null,
          allDayLocalDate: new Date('2025-10-10T00:00:00.000Z'),
          allDay: true,
          location: null,
          taskId: 1,
        }),
      });
    });

    it('creates a group sub-task when actor is member', async () => {
      const groupTask = { ...parentTask, groupId: 5 };
      mockPrismaService.task.findUnique.mockResolvedValueOnce(groupTask);
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        userId: user.id,
      });
      mockPrismaService.subTask.create.mockResolvedValueOnce({
        id: 101,
        ...payload,
        allDay: true,
      } as any);

      await tasksService.createSubTask(payload);

      expect(mockPrismaService.subTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'Sub Task 1',
          description: null,
          dueAtUtc: null,
          allDayLocalDate: new Date('2025-10-10T00:00:00.000Z'),
          allDay: true,
          location: null,
          taskId: 1,
        }),
      });
    });

    it('should throw TaskNotFoundError if parent task not found', async () => {
      payload.parentTaskId = 999;
      mockPrismaService.task.findUnique.mockResolvedValueOnce(null);

      await expect(tasksService.createSubTask(payload)).rejects.toBeInstanceOf(
        TasksErrors.TaskNotFoundError,
      );
    });

    it('should not call create if is a personal task and not owner', async () => {
      payload.actorId = 999;
      mockPrismaService.task.findUnique.mockResolvedValue(parentTask);
      await expect(tasksService.createSubTask(payload)).rejects.toBeInstanceOf(
        TasksErrors.TaskForbiddenError,
      );
      expect(mockPrismaService.subTask.create).not.toHaveBeenCalled();
    });

    it('should not call create if is a group task and user not member', async () => {
      const groupTask = { ...parentTask, groupId: 5 };
      mockPrismaService.task.findUnique.mockResolvedValueOnce(groupTask);
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce(null);

      await expect(tasksService.createSubTask(payload)).rejects.toBeInstanceOf(
        TasksErrors.TaskForbiddenError,
      );
      expect(mockPrismaService.subTask.create).not.toHaveBeenCalled();
    });
  });

  describe('getSubTasksByParentTaskId', () => {
    it('returns sub-tasks for given personal parent task id', async () => {
      const subTasks = [
        { id: 1, taskId: lowTask.id, title: 'Sub Task 1' },
        { id: 2, taskId: lowTask.id, title: 'Sub Task 2' },
      ];
      mockPrismaService.task.findUnique.mockResolvedValueOnce(lowTask);

      mockPrismaService.subTask.findMany.mockResolvedValueOnce(subTasks);

      const result = await tasksService.getSubTasksByParentTaskId(
        lowTask.id,
        user.id,
      );

      expect(mockPrismaService.subTask.findMany).toHaveBeenCalledWith({
        where: { taskId: lowTask.id },
      });

      expect(result).toBe(subTasks);
    });

    it('returns sub-tasks for given group parent task id', async () => {
      const groupParentTask = { ...lowTask, groupId: 1 };
      const subTasks = [
        { id: 3, taskId: lowTask.id, title: 'Sub Task A' },
        { id: 4, taskId: lowTask.id, title: 'Sub Task B' },
      ];
      mockPrismaService.task.findUnique.mockResolvedValueOnce(groupParentTask);
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        userId: user.id,
      });
      mockPrismaService.subTask.findMany.mockResolvedValueOnce(subTasks);

      const result = await tasksService.getSubTasksByParentTaskId(
        lowTask.id,
        user.id,
      );

      expect(mockPrismaService.subTask.findMany).toHaveBeenCalledWith({
        where: { taskId: lowTask.id },
      });

      expect(result).toBe(subTasks);
    });

    it('returns empty array if no sub-tasks', async () => {
      mockPrismaService.subTask.findMany.mockResolvedValueOnce([]);
      mockPrismaService.task.findUnique.mockResolvedValueOnce(lowTask);

      const result = await tasksService.getSubTasksByParentTaskId(
        lowTask.id,
        user.id,
      );

      expect(result).toEqual([]);
    });

    it('should throw TaskNotFoundError if parent task not found', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(null);

      await expect(
        tasksService.getSubTasksByParentTaskId(999, user.id),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);

      expect(mockPrismaService.subTask.findMany).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError if a personal parent task exists and actor not owner', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(lowTask);

      await expect(
        tasksService.getSubTasksByParentTaskId(lowTask.id, 999),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);

      expect(mockPrismaService.subTask.findMany).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError if a group parent task exists and actor not member', async () => {
      const parentTask = { ...lowTask, groupId: 5 };
      mockPrismaService.task.findUnique.mockResolvedValueOnce(parentTask);
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce(null);

      await expect(
        tasksService.getSubTasksByParentTaskId(lowTask.id, 999),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);

      expect(mockPrismaService.subTask.findMany).not.toHaveBeenCalled();
    });
  });
});
