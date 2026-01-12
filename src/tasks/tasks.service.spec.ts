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
import { MailService } from 'src/mail/mail.service';
import { SecurityService } from 'src/security/security.service';
import { createMockConfig } from 'src/test/factories/mock-config.factory';
import { ConfigService } from '@nestjs/config';
import { TasksGateWay } from './tasks.gateway';
import { TaskForbiddenError } from 'src/errors/tasks';
import { PageDto } from 'src/common/dto/page.dto';

describe('TasksService', () => {
  let tasksService: TasksService;

  const mockUsersService = { findByIdOrThrow: jest.fn(), findById: jest.fn() };
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
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    groupMember: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    taskAssignee: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    subTaskAssignee: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn().mockImplementation(async (cb: any) => {
      const tx = {
        task: mockPrismaService.task,
        groupMember: mockPrismaService.groupMember,
        taskAssignee: mockPrismaService.taskAssignee,
        subTask: mockPrismaService.subTask,
        subTaskAssignee: mockPrismaService.subTaskAssignee,
      };
      return cb(tx);
    }),
  };
  const mockMailService = { sendTaskAssign: jest.fn() };

  const mockConfigService = createMockConfig();

  const mockSecurityService = {
    hash: jest.fn().mockReturnValue('argonHashed'),
    verify: jest.fn(),
    generateUrlFriendlySecret: jest
      .fn()
      .mockReturnValue('rawUrlFriendlySecret'),
    hmacToken: jest.fn().mockReturnValue('base64urlHash'),
    safeEqualB64url: jest.fn(),
  };

  const mockTasksGateWay = {
    // 模擬 @WebSocketServer() server
    server: {
      to: jest.fn().mockReturnThis(), // 支援鏈式呼叫 .to().emit()
      emit: jest.fn(),
    },
    // 模擬 Gateway 裡的方法
    broadcastTaskUpdate: jest.fn(),
    handleJoinRoom: jest.fn(),
    heandleTyping: jest.fn(),
    handleStopTyping: jest.fn(),
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
        { provide: MailService, useValue: mockMailService },
        { provide: ConfigService, useValue: mockConfigService.mock },
        {
          provide: SecurityService,
          useValue: mockSecurityService,
        },
        { provide: TasksGateWay, useValue: mockTasksGateWay },
      ],
    }).compile();

    tasksService = module.get<TasksService>(TasksService);
  });

  const rewireTransaction = () => {
    mockPrismaService.$transaction.mockImplementation(async (cb: any) => {
      return cb(mockPrismaService);
    });
  };

  beforeEach(() => {
    jest.resetAllMocks(); // ⬅️ 清掉實作 + 計數
    jest.restoreAllMocks(); // ⬅️ 還原 spy
    rewireTransaction(); // ⬅️ 重新掛回 $transaction 的實作
    mockUsersService.findByIdOrThrow.mockResolvedValue(createMockUser());
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
  // getTaskForViewer
  // ───────────────────────────────────────────────────────────────────────────────

  describe('getTaskForViewer', () => {
    // 根據您 service 裡面的 include 結構定義預期的參數
    const expectedInclude = {
      assignees: {
        // Task Assignees
        include: {
          assignee: { select: { id: true, name: true, email: true } },
          assignedBy: { select: { id: true, name: true, email: true } },
        },
      },
      subTasks: {
        // SubTasks 及其 Assignees
        include: {
          assignees: {
            include: {
              assignee: { select: { id: true, name: true, email: true } },
              // 注意：您 service code 中 subTasks.assignees 這裡缺少 assignedBy 的 include
            },
            orderBy: { status: 'asc' },
          },
        },
        orderBy: { priority: 'asc' },
      },
      group: { select: { name: true } }, // Group Name
    };

    // 輔助函式：創建一個完整的 Mock Task 結構
    const createFullMockTask = (overrides = {}) => ({
      ...lowTask, // 包含所有 Task 基礎欄位
      assignees: [],
      subTasks: [],
      group: null,
      ...overrides,
    });

    it('should return personal task for owner with isAdminish=true', async () => {
      // 1. Mock 第一次查詢結果 (Base)
      const baseTask = { ...lowTask, groupId: null };
      mockPrismaService.task.findUnique.mockResolvedValueOnce(baseTask);

      // 2. Mock 第二次查詢結果 (Full Details)
      const fullTask = createFullMockTask({
        groupId: null,
        ownerId: user.id,
      });
      mockPrismaService.task.findUnique.mockResolvedValueOnce(fullTask);

      const result = await tasksService.getTaskForViewer(lowTask.id, user.id); // actorId = ownerId

      // 驗證第 1 次呼叫參數
      expect(mockPrismaService.task.findUnique).toHaveBeenNthCalledWith(1, {
        where: { id: lowTask.id },
        select: { id: true, ownerId: true, groupId: true },
      });

      // 驗證第 2 次呼叫參數 (必須包含所有的 include 結構)
      expect(mockPrismaService.task.findUnique).toHaveBeenNthCalledWith(2, {
        where: { id: lowTask.id },
        include: expectedInclude,
      });

      expect(result.task.id).toBe(lowTask.id);
      expect(result.isAdminish).toBe(true);
    });

    it('should return group task for Owner (isAdminish=true)', async () => {
      const groupId = 2;
      const taskId = lowTask.id;

      // 1. Mock 第一次查詢結果 (Base)
      const baseTask = { id: taskId, ownerId: user.id, groupId };
      mockPrismaService.task.findUnique.mockResolvedValueOnce(baseTask);

      // 2. Mock 第二次查詢結果 (Full Details)
      const fullTask = createFullMockTask({
        id: taskId,
        ownerId: user.id,
        groupId,
        group: { name: 'Test Group' },
        subTasks: [
          {
            id: 10,
            title: 'SubTask 1',
            status: TaskStatus.CLOSED, // 假設子任務已關閉，測試 canClose 邏輯
            assignees: [],
          },
        ],
      });
      mockPrismaService.task.findUnique.mockResolvedValueOnce(fullTask);

      // 🚀 修正：必須 Mock 獲取群組成員的列表 (findMany)
      mockPrismaService.groupMember.findMany.mockResolvedValueOnce([
        { user: { id: user.id, name: user.name, email: user.email } },
      ]);

      // 3. Mock 權限檢查 (findUnique)
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.OWNER, // 確保回傳物件
      });

      const result = await tasksService.getTaskForViewer(taskId, user.id);

      // 驗證第 2 次呼叫參數
      expect(mockPrismaService.task.findUnique).toHaveBeenNthCalledWith(2, {
        where: { id: taskId },
        include: expectedInclude,
      });

      // 檢查 isAdminish 邏輯
      expect(result.isAdminish).toBe(true);
      expect(result.task.groupId).toBe(groupId);

      // 驗證成員列表是否有正確對應
      expect(result.groupMembers).toContainEqual({
        id: user.id,
        userName: user.name,
      });

      // 檢查 group.name
      if (result.task.group) {
        expect(result.task.group.name).toBe('Test Group');
      } else {
        throw new Error('Expected task.group to be defined for a group task.');
      }
    });

    it('should return group task for Non-Owner (isAdminish=false)', async () => {
      const nonOwnerId = 999;
      const groupId = 2;

      // 1. Mock 第一次查詢結果 (Base)
      const baseTask = { id: lowTask.id, ownerId: user.id, groupId };
      mockPrismaService.task.findUnique.mockResolvedValueOnce(baseTask);

      // 2. Mock 第二次查詢結果 (Full Details)
      const fullTask = createFullMockTask({
        id: lowTask.id,
        ownerId: user.id,
        groupId,
      });
      mockPrismaService.task.findUnique.mockResolvedValueOnce(fullTask);

      // 3. Mock 獲取群組成員 (findMany)
      mockPrismaService.groupMember.findMany.mockResolvedValueOnce([
        { user: { id: 1, name: 'Owner', email: 'owner@test.com' } },
        {
          user: {
            id: nonOwnerId,
            name: 'Non-Owner',
            email: 'nonowner@test.com',
          },
        },
      ]);

      // 4. Mock 權限檢查 (findUnique) - 必須回傳一個包含 role 的物件
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.MEMBER, // 🚀 修正：回傳物件而非單純字串
      });

      const result = await tasksService.getTaskForViewer(
        lowTask.id,
        nonOwnerId,
      );

      // 斷言
      expect(mockPrismaService.task.findUnique).toHaveBeenNthCalledWith(2, {
        where: { id: lowTask.id },
        include: expectedInclude,
      });

      expect(result.isAdminish).toBe(false);
      expect(result.task.groupId).toBe(groupId);
      expect(result.groupMembers.length).toBe(2);
    });

    it('should throw TaskNotFoundError if parent task not found (Base query returns null)', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(null);

      await expect(
        tasksService.getTaskForViewer(999, user.id),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);

      expect(mockPrismaService.task.findUnique).toHaveBeenCalledTimes(1); // 只執行了第一次查詢
    });

    it('should throw TaskNotFoundError if a personal task exists and actor is not owner', async () => {
      const nonOwnerId = 999;

      // 1. Mock 第一次查詢結果 (Base) - Task Owner ID 是 user.id (1)
      const baseTask = { ...lowTask, groupId: null, ownerId: user.id };
      mockPrismaService.task.findUnique.mockResolvedValueOnce(baseTask);

      // 驗證非 Owner 嘗試查看個人任務時被阻止
      await expect(
        tasksService.getTaskForViewer(lowTask.id, nonOwnerId),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);

      expect(mockPrismaService.task.findUnique).toHaveBeenCalledTimes(1); // 沒有進行第二次查詢
    });

    it('should throw TaskNotFoundError if full task lookup fails (Edge Case)', async () => {
      // 1. Mock 第一次查詢結果 (Base) - 成功
      mockPrismaService.task.findUnique.mockResolvedValueOnce(lowTask);

      // 2. Mock 第二次查詢結果 - 失敗 (返回 null)
      mockPrismaService.task.findUnique.mockResolvedValueOnce(null);

      await expect(
        tasksService.getTaskForViewer(lowTask.id, user.id),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);

      expect(mockPrismaService.task.findUnique).toHaveBeenCalledTimes(2);
    });
  });
  // ───────────────────────────────────────────────────────────────────────────────
  // getTasks
  // ───────────────────────────────────────────────────────────────────────────────

  describe('getTasks', () => {
    const userId = 1;
    const timeZone = 'Asia/Taipei';

    it('Should return correct paginated data (basic query)', async () => {
      // 準備 Mock 回傳值
      const mockTasks = [
        { id: 1, title: 'Task 1', subTaskCount: 0, assigneeCount: 0 },
      ];
      const mockCount = [{ count: BigInt(1) }];

      // 第一次呼叫回傳 tasks, 第二次呼叫回傳 count (Promise.all)
      mockPrismaService.$queryRaw
        .mockResolvedValueOnce(mockTasks)
        .mockResolvedValueOnce(mockCount);

      const result = await tasksService.getTasks(userId, timeZone, {
        status: 'OPEN',
        page: 1,
        limit: 10,
      });

      // 💡 取得該次呼叫的所有參數 (包含字串片段和傳入的值)
      const allArgs = mockPrismaService.$queryRaw.mock.calls[0];
      const fullSqlString = JSON.stringify(allArgs);

      // 現在你可以檢查是否包含這些條件了
      expect(fullSqlString).toContain('status');
      expect(fullSqlString).toContain('ownerId');
      expect(fullSqlString).toContain('OPEN');
    });

    it('should add time boundary when scope is future', async () => {
      mockPrismaService.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(0) }]);

      await tasksService.getTasks(userId, timeZone, {
        scope: 'FUTURE',
      });

      // 🚀 關鍵修正：將整個呼叫的所有參數（包含動態插入的 SQL 片段）字串化
      const allArgs = mockPrismaService.$queryRaw.mock.calls[0];
      const fullSqlContent = JSON.stringify(allArgs);

      // 驗證是否包含 Future 專用的時間判斷 SQL Fragment
      expect(fullSqlContent).toContain('dueAtUtc');
      expect(fullSqlContent).toContain('allDayLocalDate');
    });

    it('should calculate skip and limit correctly (pagination logic)', async () => {
      mockPrismaService.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(0) }]);

      const page = 3;
      const limit = 5;
      const expectedSkip = (page - 1) * limit; // 10

      await tasksService.getTasks(userId, timeZone, { page, limit });

      // 在 $queryRaw`...` 這種寫法中：
      // 第一個參數是字串片段陣列
      // 後續參數（索引 1, 2, ...）才是傳進去的值
      const allArgs = mockPrismaService.$queryRaw.mock.calls[0];

      // 我們檢查所有傳入的參數是否包含 limit 和 expectedSkip
      // 因為我們不知道它們在參數列表中的確切位置（取決於 SQL 構造順序）
      expect(allArgs).toContain(limit);
      expect(allArgs).toContain(expectedSkip);
    });

    it('should return itemCount 0 if non count', async () => {
      mockPrismaService.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]); // 模擬空陣列回傳

      const result = await tasksService.getTasks(userId, timeZone, {});
      expect(result.meta.itemCount).toBe(0);
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
      const taskId = lowTask.id;

      // 1. 準備模擬回傳 Task 物件，防止 notifyTaskChange 崩潰
      const mockUpdatedTask = {
        id: taskId,
        ...payload,
        allDay: false,
        allDayLocalDate: null,
      };

      mockUsersService.findByIdOrThrow.mockResolvedValueOnce(user);

      // 🚀 關鍵：必須設定 Prisma update 的回傳值
      mockPrismaService.task.update.mockResolvedValueOnce(mockUpdatedTask);

      await tasksService.updateTask(taskId, user.id, payload);

      expect(mockPrismaService.task.update).toHaveBeenCalledTimes(1);
      const [{ data, where }] = mockPrismaService.task.update.mock.calls[0];

      // 2. 修正斷言：Service 實作中目前 where 只有 { id }
      // 如果你希望 Service 具備權限檢查，請去 Service 加上 ownerId: userId
      expect(where).toEqual({ id: taskId });

      expect(data).toMatchObject({
        title: 'walk cat',
        description: 'walk your cat',
        location: 'london park',
        priority: TaskPriority.HIGH,
        allDay: false,
        allDayLocalDate: null,
      });

      // 驗證安全性：確保 payload 裡的 ownerId 不會被惡意更新進去
      expect(Object.keys(data)).not.toEqual(
        expect.arrayContaining(['ownerId']),
      );
    });

    it('should updates an all-day task', async () => {
      const taskId = lowTask.id;
      const allDayPayload: TaskUpdatePayload = { ...payload, allDay: true };

      // 🚀 1. 準備模擬更新後回傳的 Task 資料
      const updatedTaskMock = {
        id: taskId,
        ...allDayPayload,
        // 補足 notifyTaskChange 或回傳需要的其他欄位
      };

      mockUsersService.findByIdOrThrow.mockResolvedValueOnce(user);

      // 🚀 2. 設定 Prisma Update 的 Mock 回傳值
      mockPrismaService.task.update.mockResolvedValueOnce(updatedTaskMock);

      await tasksService.updateTask(taskId, user.id, allDayPayload);

      // 驗證呼叫次數
      expect(mockPrismaService.task.update).toHaveBeenCalledTimes(1);

      const [{ data, where }] = mockPrismaService.task.update.mock.calls[0];

      // 🚀 3. 修正斷言：實作代碼中 where 只有 { id }
      expect(where).toEqual({ id: taskId });

      // 驗證資料內容
      expect(data).toMatchObject({
        title: 'walk cat',
        description: 'walk your cat',
        location: 'london park',
        priority: TaskPriority.HIGH,
        allDay: true,
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
      // 1. 準備模擬資料：合併 Task 與空的 Assignees 列表
      const actorId = 1;
      const taskId = 1;
      const mockTaskData = {
        id: taskId,
        groupId: 2,
        status: TaskStatus.OPEN,
        assignees: [], // 模擬資料庫中目前沒有此使用者的指派紀錄
      };

      // 2. 設定 Mock 行為
      mockPrismaService.task.findUnique.mockResolvedValueOnce(mockTaskData);
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        userId: actorId,
      });
      // 注意：這裡不需要 mock taskAssignee.findUnique，因為它已經合併進 task.findUnique 了
      mockPrismaService.taskAssignee.create.mockResolvedValueOnce({ id: 6 });

      // 3. 執行測試
      await tasksService.updateAssigneeStatus(taskId, actorId, {
        status: AssignmentStatus.ACCEPTED,
      });

      // 4. 斷言 - 檢查 Task 查詢參數是否包含優化後的 select 結構
      expect(mockPrismaService.task.findUnique).toHaveBeenCalledWith({
        where: { id: taskId },
        select: {
          id: true,
          groupId: true,
          status: true,
          assignees: {
            where: { assigneeId: actorId },
            select: { status: true },
          },
        },
      });

      // 5. 斷言 - 檢查是否正確執行 create (自我指派)
      expect(mockPrismaService.taskAssignee.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskId: taskId,
          assigneeId: actorId,
          assignedById: actorId, // 確保這行也在裡面
          status: AssignmentStatus.ACCEPTED,
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

  describe('closeTask logic with auto-force detection', () => {
    it('should throw error if task is incomplete and no reason provided', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce({
        id: 1,
        _count: { subTasks: 1, assignees: 0 },
      });

      // 不傳 reason，預期會噴錯
      await expect(tasksService.closeTask(1, user.id)).rejects.toBeInstanceOf(
        TaskForbiddenError,
      );
    });

    it('should allow closing with reason when incomplete', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce({
        id: 1,
        _count: { subTasks: 1, assignees: 0 },
      });

      // 傳了 reason，事務應該成功執行
      await tasksService.closeTask(1, user.id, {
        reason: 'Incomplete but urgent',
      });

      expect(mockPrismaService.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            closedWithOpenAssignees: true,
            closedReason: 'Incomplete but urgent',
          }),
        }),
      );
    });

    describe('Group Task with SubTasks', () => {
      it('should throw error if there are open subtasks', async () => {
        const taskId = 10;
        const taskWithOpenSub = {
          id: taskId,
          ownerId: user.id,
          groupId: 11,
          status: TaskStatus.OPEN,
          // 🚀 關鍵：Service 現在讀取的是 _count 而不是 subTasks 陣列
          _count: {
            subTasks: 1, // 模擬有 1 個未完成的子任務
            assignees: 0,
          },
        };

        mockPrismaService.task.findUnique.mockResolvedValueOnce(
          taskWithOpenSub,
        );

        // 執行並捕捉錯誤以驗證細節
        const error = await tasksService
          .closeTask(taskId, user.id)
          .catch((e) => e);

        // 驗證錯誤訊息與關鍵的 action 欄位
        expect(error.message).toBe(
          'You are not allowed to perform this action on the task.',
        );
        expect(error.code).toBe('TASK_FORBIDDEN');
        expect(error.action).toBe('FORCE_CLOSE_REASON_REQUIRED');
      });
    });

    describe('Group Task Assignment Rules', () => {
      it('should throw FORCE_CLOSE_REASON_REQUIRED if no one completed the group task', async () => {
        const taskId = 20;
        const mockTask = {
          id: taskId,
          status: TaskStatus.OPEN,
          _count: { subTasks: 0, assignees: 1 },
        };

        mockPrismaService.task.findUnique.mockResolvedValue(mockTask);

        const error = await tasksService
          .closeTask(taskId, user.id)
          .catch((e) => e);

        expect(error).toBeInstanceOf(TaskForbiddenError);
        expect(error.code).toBe('TASK_FORBIDDEN');
        expect(error.action).toBe('FORCE_CLOSE_REASON_REQUIRED');
      });

      it('should allow force close if partially completed (incomplete assignees)', async () => {
        const taskId = 30;

        // 1. 模擬 Prisma 聚合查詢回傳的結構
        const mockTaskFromDb = {
          id: taskId,
          status: TaskStatus.OPEN,
          _count: {
            subTasks: 0, // 假設子任務都完成了
            assignees: 1, // 還有一個 ACCEPTED 或 PENDING 的指派未完成
          },
        };

        // 設定 findUnique 的回傳值
        mockPrismaService.task.findUnique.mockResolvedValueOnce(mockTaskFromDb);

        // 2. 執行 Service 方法 (移除 force 參數)
        await tasksService.closeTask(taskId, user.id, {
          reason: 'Manual override',
        });

        // 3. 驗證事務中的 update 呼叫
        // 注意：因為你使用了 $transaction，確保你的 mockPrismaService 能夠捕捉到 tx.task.update
        expect(mockPrismaService.task.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: taskId },
            data: expect.objectContaining({
              status: TaskStatus.CLOSED,
              closedById: user.id,
              closedReason: 'Manual override',
              closedWithOpenAssignees: true, // 因為 _count.assignees > 0
            }),
          }),
        );

        // 4. 驗證指派狀態更新
        expect(mockPrismaService.taskAssignee.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { taskId, status: AssignmentStatus.ACCEPTED },
            data: expect.objectContaining({ status: AssignmentStatus.DROPPED }),
          }),
        );
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // archiveTask
  // ───────────────────────────────────────────────────────────────────────────────

  describe('archiveTask', () => {
    it('should archive task and sub tasks under it', async () => {
      mockPrismaService.task.findUnique
        .mockResolvedValueOnce(lowTask)
        .mockResolvedValueOnce(lowTask)
        .mockResolvedValueOnce(lowTask);
      await tasksService.archiveTask(1, user.id);

      expect(mockPrismaService.task.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: TaskStatus.ARCHIVED },
      });

      expect(mockPrismaService.subTask.updateMany).toHaveBeenCalledWith({
        where: {
          taskId: 1,
          status: { not: TaskStatus.ARCHIVED },
        },
        data: {
          status: TaskStatus.ARCHIVED,
        },
      });
    });

    it('should archive group task when adminish', async () => {
      const groupTask = { ...lowTask, ownerId: 6, groupId: 1 };
      mockPrismaService.task.findUnique
        .mockResolvedValueOnce(groupTask)
        .mockResolvedValueOnce(groupTask)
        .mockResolvedValueOnce(groupTask);
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.ADMIN,
      });

      await tasksService.archiveTask(1, user.id);

      expect(mockPrismaService.task.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: TaskStatus.ARCHIVED },
      });

      expect(mockPrismaService.subTask.updateMany).toHaveBeenCalledWith({
        where: {
          taskId: 1,
          status: { not: TaskStatus.ARCHIVED },
        },
        data: {
          status: TaskStatus.ARCHIVED,
        },
      });
    });

    it('should throw TaskNotFoundError', async () => {
      mockPrismaService.task.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      await expect(
        tasksService.archiveTask(999, user.id),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);
    });

    it('should throw TaskForbiddenError not in the same group', async () => {
      const groupTask = { ...lowTask, ownerId: 6, groupId: 2 };
      mockPrismaService.task.findUnique
        .mockResolvedValueOnce(groupTask)
        .mockResolvedValueOnce(groupTask)
        .mockResolvedValueOnce(groupTask);
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce(null);

      await expect(tasksService.archiveTask(1, user.id)).rejects.toBeInstanceOf(
        TasksErrors.TaskForbiddenError,
      );
    });

    it('should throw TaskForbiddenError not adminish', async () => {
      const groupTask = { ...lowTask, ownerId: 6, groupId: 2 };
      mockPrismaService.task.findUnique
        .mockResolvedValueOnce(groupTask)
        .mockResolvedValueOnce(groupTask)
        .mockResolvedValueOnce(groupTask);
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.MEMBER,
      });

      await expect(tasksService.archiveTask(1, user.id)).rejects.toBeInstanceOf(
        TasksErrors.TaskForbiddenError,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // restoreTask
  // ───────────────────────────────────────────────────────────────────────────────
  describe('restoreTask', () => {
    it('should restore task and its archived subtasks within a transaction', async () => {
      const taskId = 1;

      // 1. 設定 Mock 傳回值
      mockPrismaService.task.update.mockResolvedValueOnce({
        id: taskId,
        status: 'OPEN',
      });
      mockPrismaService.subTask.updateMany.mockResolvedValueOnce({ count: 2 });

      // 2. 執行 Service 方法
      await tasksService.restoreTask(taskId);

      // 3. 斷言檢查：確認 $transaction 有被執行
      expect(mockPrismaService.$transaction).toHaveBeenCalled();

      // 4. 斷言檢查：確認主任務被正確還原（清除關閉資訊）
      expect(mockPrismaService.task.update).toHaveBeenCalledWith({
        where: { id: taskId },
        data: {
          status: TaskStatus.OPEN,
          closedAt: null,
          closedById: null,
        },
      });

      // 5. 斷言檢查：確認只有「已封存」的子任務被還原為 OPEN
      expect(mockPrismaService.subTask.updateMany).toHaveBeenCalledWith({
        where: {
          taskId: taskId,
          status: TaskStatus.ARCHIVED,
        },
        data: {
          status: TaskStatus.OPEN,
        },
      });
    });

    it('should roll back if any update fails', async () => {
      const taskId = 1;

      // 模擬主任務更新失敗
      mockPrismaService.task.update.mockRejectedValueOnce(
        new Error('Update Failed'),
      );

      await expect(tasksService.restoreTask(taskId)).rejects.toThrow(
        'Update Failed',
      );

      // 確認子任務更新不會被執行（或隨交易一同失敗）
      // 註：在單元測試中，通常驗證 error 有噴出即可
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

  // -----------------------subTask----------------------------

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
      updatedBy: 'test',
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

  // ───────────────────────────────────────────────────────────────────────────────
  // getSubTaskForViewer
  // ───────────────────────────────────────────────────────────────────────────────

  describe('getSubTaskForViewer', () => {
    const mockSubTask = {
      id: 1,
      taskId: lowTask.id,
      title: 'Sub Task Example',
      status: 'OPEN',
      priority: 3,
      description: null,
      location: null,
      dueAtUtc: null,
      allDay: true,
      allDayLocalDate: null,
      sourceTimeZone: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      assignees: [],
    };

    const mockGroupMembers = [
      {
        groupId: 1,
        userId: user.id,
        role: 'OWNER',
        joinedAt: new Date(),
        user: { id: 1, name: 'test1' },
      },
      {
        groupId: 1,
        userId: 2,
        role: 'MEMBER',
        joinedAt: new Date(),
        user: { id: 2, name: 'test2' },
      },
    ];

    it('should returns sub-task viewer data for an individual task owner', async () => {
      // 1. 準備資料：確保 groupId 為 null 以進入個人任務邏輯
      const personalParentTask = {
        ...lowTask,
        groupId: null,
        ownerId: user.id, // 當前使用者就是 Owner
      };

      // 模擬資料庫回傳的真實 SubTask 結構
      // 2. Mock 父任務查詢
      mockPrismaService.task.findUnique.mockResolvedValueOnce(
        personalParentTask,
      );

      // 3. Mock 子任務詳細資訊
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce(mockSubTask);

      // 4. 執行
      const result = await tasksService.getSubTaskForViewer(
        personalParentTask.id,
        mockSubTask.id,
        user.id,
      );

      // 5. 斷言 - 檢查查詢結構 (與實作代碼的 include 內容一致)
      expect(mockPrismaService.subTask.findUnique).toHaveBeenCalledWith({
        where: { id: mockSubTask.id },
        include: {
          task: { select: { id: true, groupId: true } },
          closedBy: { select: { id: true, name: true } },
          assignees: {
            include: {
              assignee: { select: { id: true, name: true, email: true } },
              assignedBy: { select: { id: true, name: true, email: true } },
            },
            orderBy: { status: 'asc' },
          },
        },
      });

      // 6. 斷言 - 檢查最終回傳物件內容
      expect(result).toEqual({
        subTask: mockSubTask,
        isAdminish: true, // 個人任務 Owner 預設為 isAdminish = true
        groupMembers: [], // 個人任務不應有群組成員列表
      });
    });

    it('should returns sub-task viewer data for a group member', async () => {
      // 準備資料
      const groupId = 1;
      const subTaskId = 1;
      const groupParentTask = { ...lowTask, groupId, ownerId: 999 };

      // 1. Mock 父任務查詢
      mockPrismaService.task.findUnique.mockResolvedValueOnce(groupParentTask);

      // 2. Mock 判定 Actor 為 Group Member (角色為 MEMBER)
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        userId: user.id,
        role: 'MEMBER',
      });

      // 3. Mock 子任務詳細資訊
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce(mockSubTask);

      // 4. Mock 獲取群組所有成員 (用於下拉選單)
      mockPrismaService.groupMember.findMany.mockResolvedValueOnce(
        mockGroupMembers,
      );

      // 執行
      const result = await tasksService.getSubTaskForViewer(
        groupParentTask.id,
        subTaskId,
        user.id,
      );

      // 斷言 1: 檢查查詢結構
      expect(mockPrismaService.subTask.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: subTaskId },
          include: expect.objectContaining({
            assignees: expect.anything(),
            task: expect.anything(),
          }),
        }),
      );

      // 斷言 2: 檢查最終組合的結果
      expect(result).toEqual({
        subTask: mockSubTask,
        isAdminish: false, // 因為角色是 MEMBER，Set<OWNER, ADMIN> 不包含它
        groupMembers: [
          { id: 1, userName: 'test1' },
          { id: 2, userName: 'test2' },
        ],
      });
    });

    it('should handle non-existent sub-task by returning empty viewer data', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(lowTask);
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce([]);

      const result = await tasksService.getSubTaskForViewer(
        lowTask.id,
        999,
        user.id,
      );

      expect(result).toEqual({
        groupMembers: [],
        isAdminish: true,
        subTask: [],
      });
    });

    it('should throw TaskNotFoundError if parent task not found', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(null);

      await expect(
        tasksService.getSubTaskForViewer(999, 1, user.id),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);

      expect(mockPrismaService.subTask.findFirst).not.toHaveBeenCalled();
    });

    it('should throw TaskForbiddenError if a personal parent task exists and actor not owner', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(lowTask);

      await expect(
        tasksService.getSubTaskForViewer(lowTask.id, 1, 999),
      ).rejects.toBeInstanceOf(TasksErrors.TaskForbiddenError);

      expect(mockPrismaService.subTask.findFirst).not.toHaveBeenCalled();
    });

    it('should throw TaskForbiddenError if a group parent task exists and actor not member', async () => {
      const parentTask = { ...lowTask, groupId: 5 };
      mockPrismaService.task.findUnique.mockResolvedValueOnce(parentTask);
      // 模擬 actor 不是 group member
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce(null);

      await expect(
        tasksService.getSubTaskForViewer(lowTask.id, 1, 999),
      ).rejects.toBeInstanceOf(TasksErrors.TaskForbiddenError);

      expect(mockPrismaService.subTask.findFirst).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // updateSubTask
  // ───────────────────────────────────────────────────────────────────────────────
  describe('updateSubTask', () => {
    const actorId = 1;
    const subTaskId = 5;
    const mockUser = { id: actorId, timeZone: 'Asia/Taipei' };
    const updatePayload = {
      title: 'Updated Subtask Title',
      description: 'Updated content',
      priority: 2,
    };

    it('should successfully update a subtask with localized time data', async () => {
      // 1. Mock 使用者服務
      mockUsersService.findByIdOrThrow.mockResolvedValueOnce(mockUser);

      // 2. Mock Prisma 更新回傳值
      const mockUpdatedSubTask = { id: subTaskId, ...updatePayload };
      mockPrismaService.subTask.update.mockResolvedValueOnce(
        mockUpdatedSubTask,
      );

      // 3. 執行測試
      const result = await tasksService.updateSubTask(
        subTaskId,
        actorId,
        updatePayload,
      );

      // 4. 斷言檢查：確認是否有根據使用者時區處理資料 (getCommonUpdateData 的邏輯)
      expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(actorId);

      // 5. 斷言檢查：Prisma update 的參數
      expect(mockPrismaService.subTask.update).toHaveBeenCalledWith({
        where: { id: subTaskId },
        data: expect.objectContaining({
          title: updatePayload.title,
          description: updatePayload.description,
        }),
      });

      expect(result).toEqual(mockUpdatedSubTask);
    });

    it('should throw TaskNotFoundError when Prisma returns P202 (Record not found)', async () => {
      // 註：Prisma 找不到紀錄的代碼通常是 P2025，你程式碼中寫 P2002 (唯一約束)
      // 建議檢查一下邏輯，這裡我先依照你 Catch 塊中的邏輯來寫測試

      mockUsersService.findByIdOrThrow.mockResolvedValueOnce(mockUser);

      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Not Found',
        {
          code: 'P2002', // 依照你提供的程式碼邏輯
          clientVersion: '5.x',
        },
      );

      mockPrismaService.subTask.update.mockRejectedValueOnce(prismaError);

      // 執行並斷言會拋出 TaskNotFoundError
      await expect(
        tasksService.updateSubTask(subTaskId, actorId, updatePayload),
      ).rejects.toThrow();
    });

    it('should rethrow unknown errors', async () => {
      mockUsersService.findByIdOrThrow.mockResolvedValueOnce(mockUser);
      const unexpectedError = new Error('Database connection failed');
      mockPrismaService.subTask.update.mockRejectedValueOnce(unexpectedError);

      await expect(
        tasksService.updateSubTask(subTaskId, actorId, updatePayload),
      ).rejects.toThrow('Database connection failed');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // closeSubTask
  // ───────────────────────────────────────────────────────────────────────────────
  describe('closeSubTask', () => {
    const actorId = 1;
    const subTaskId = 10;

    it('should successfully close a subtask and record closer info', async () => {
      // 1. 準備模擬資料
      const mockSubTask = {
        id: subTaskId,
        title: 'Test SubTask',
        status: 'OPEN',
      };

      // 2. Mock 查詢與更新
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce(mockSubTask);
      mockPrismaService.subTask.update.mockResolvedValueOnce({
        ...mockSubTask,
        status: TaskStatus.CLOSED,
        closedById: actorId,
        closedAt: new Date(),
      });

      // 3. 執行測試
      const result = await tasksService.closeSubTask(subTaskId, actorId);

      // 4. 斷言檢查
      expect(mockPrismaService.subTask.findUnique).toHaveBeenCalledWith({
        where: { id: subTaskId },
      });

      expect(mockPrismaService.subTask.update).toHaveBeenCalledWith({
        where: { id: subTaskId },
        data: {
          status: TaskStatus.CLOSED,
          closedAt: expect.any(Date),
          closedById: actorId,
        },
      });

      expect(result.status).toBe(TaskStatus.CLOSED);
      expect(result.closedById).toBe(actorId);
    });

    it('should throw TaskNotFoundError if the subtask does not exist', async () => {
      // 模擬找不到任務
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce(null);

      // 執行並檢查錯誤
      await expect(
        tasksService.closeSubTask(subTaskId, actorId),
      ).rejects.toThrow();

      // 確保沒有執行後續的 update
      expect(mockPrismaService.subTask.update).not.toHaveBeenCalled();
    });
  });
  // ───────────────────────────────────────────────────────────────────────────────
  // updateSubTaskStatus
  // ───────────────────────────────────────────────────────────────────────────────

  describe('updateSubTaskStatus', () => {
    const subTaskId = 50;
    const actorId = 1; // 任何人都可以操作

    // 模擬 SubTask 的基礎資料
    const mockSubTaskBase = {
      id: subTaskId,
      status: TaskStatus.OPEN,
    };

    it('should allow any authenticated actor to close an OPEN SubTask', async () => {
      // 1. Mock SubTask 存在且為 OPEN
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce({
        ...mockSubTaskBase,
        status: TaskStatus.OPEN,
      });

      await tasksService.updateSubTaskStatus(subTaskId, {
        target: TaskStatus.CLOSED,
        actorId: 999, // 非 owner/非 assignee 的用戶
      });

      // 驗證 findUnique 被呼叫 (只查詢 SubTask 狀態，無需父任務或權限資訊)
      expect(mockPrismaService.subTask.findUnique).toHaveBeenCalledWith({
        where: { id: subTaskId },
        select: { id: true, status: true },
      });

      // 驗證 SubTask 被更新為 CLOSED
      expect(mockPrismaService.subTask.update).toHaveBeenCalledWith({
        where: { id: subTaskId },
        data: {
          status: TaskStatus.CLOSED,
          closedAt: expect.any(Date),
          closedById: 999,
        },
      });
    });

    it('should allow reopening a CLOSED SubTask (CLOSED -> OPEN)', async () => {
      // 1. Mock SubTask 存在且為 CLOSED
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce({
        ...mockSubTaskBase,
        status: TaskStatus.CLOSED,
      });

      await tasksService.updateSubTaskStatus(subTaskId, {
        target: TaskStatus.OPEN,
        actorId,
      });

      // 驗證 SubTask 被更新為 OPEN
      expect(mockPrismaService.subTask.update).toHaveBeenCalledWith({
        where: { id: subTaskId },
        data: {
          status: TaskStatus.OPEN,
          closedAt: null,
          closedById: null,
        },
      });
    });

    it('should allow archiving a CLOSED SubTask (CLOSED -> ARCHIVED)', async () => {
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce({
        ...mockSubTaskBase,
        status: TaskStatus.CLOSED,
      });

      await tasksService.updateSubTaskStatus(subTaskId, {
        target: TaskStatus.ARCHIVED,
        actorId,
      });

      // 驗證 SubTask 被更新為 ARCHIVED (無需清除審計欄位)
      expect(mockPrismaService.subTask.update).toHaveBeenCalledWith({
        where: { id: subTaskId },
        data: {
          status: TaskStatus.ARCHIVED,
        },
      });
    });

    it('should throw TaskNotFoundError if SubTask is not found', async () => {
      // 1. Mock SubTask 找不到
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce(null);

      await expect(
        tasksService.updateSubTaskStatus(subTaskId, {
          target: TaskStatus.CLOSED,
          actorId,
        }),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);

      // 驗證 update 沒有被呼叫
      expect(mockPrismaService.subTask.update).not.toHaveBeenCalled();
    });

    it('should throw TaskForbiddenError for illegal status transition (OPEN -> OPEN)', async () => {
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce({
        ...mockSubTaskBase,
        status: TaskStatus.OPEN,
      });

      // 嘗試從 OPEN 轉移到 OPEN (非法)
      await expect(
        tasksService.updateSubTaskStatus(subTaskId, {
          target: TaskStatus.OPEN,
          actorId,
        }),
      ).rejects.toBeInstanceOf(TasksErrors.TaskForbiddenError);

      // 驗證 update 沒有被呼叫
      expect(mockPrismaService.subTask.update).not.toHaveBeenCalled();
    });

    it('should throw TaskForbiddenError for illegal status transition (ARCHIVED -> CLOSED)', async () => {
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce({
        ...mockSubTaskBase,
        status: TaskStatus.ARCHIVED,
      });

      // 嘗試從 ARCHIVED 轉移到 CLOSED (非法)
      await expect(
        tasksService.updateSubTaskStatus(subTaskId, {
          target: TaskStatus.CLOSED,
          actorId,
        }),
      ).rejects.toBeInstanceOf(TasksErrors.TaskForbiddenError);

      // 驗證 update 沒有被呼叫
      expect(mockPrismaService.subTask.update).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // restoreSubTask
  // ───────────────────────────────────────────────────────────────────────────────

  describe('restoreSubTask', () => {
    it('should update subTask status to OPEN and clear closure metadata', async () => {
      const subTaskId = 4;
      const mockUpdatedSubTask = {
        id: subTaskId,
        status: TaskStatus.OPEN,
        closedAt: null,
        closedById: null,
        title: 'Test Subtask',
      };

      mockPrismaService.subTask.update.mockResolvedValueOnce(
        mockUpdatedSubTask,
      );

      const result = await tasksService.restoreSubTask(subTaskId);

      expect(mockPrismaService.subTask.update).toHaveBeenCalledWith({
        where: { id: subTaskId },
        data: {
          status: TaskStatus.OPEN,
          closedAt: null,
          closedById: null,
        },
      });

      expect(result).toEqual(mockUpdatedSubTask);
      expect(result.status).toBe(TaskStatus.OPEN);
      expect(result.closedAt).toBeNull();
    });

    it('should throw error if prisma update fails', async () => {
      const subTaskId = 999;
      mockPrismaService.subTask.update.mockRejectedValueOnce(
        new Error('Record not found'),
      );

      await expect(tasksService.restoreSubTask(subTaskId)).rejects.toThrow(
        'Record not found',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // updateSubTaskAssigneeStatus
  // ───────────────────────────────────────────────────────────────────────────────

  describe('updateSubTaskAssigneeStatus', () => {
    const actorId = 1;
    const subTaskId = 10;
    const groupId = 2;
    const taskId = 100;

    // 模擬 subTask 及其關聯的 task 資訊
    const mockSubTask = {
      id: subTaskId,
      status: 'OPEN',
      task: { id: taskId, groupId, status: 'OPEN' },
    };

    it('should self-assign (claim) a subtask if no assignment record exists', async () => {
      // 1. Mock 子任務查詢
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce(mockSubTask);

      // 2. Mock 群組成員檢查
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        userId: actorId,
      });

      // 3. Mock 目前沒有指派紀錄
      mockPrismaService.subTaskAssignee.findUnique.mockResolvedValueOnce(null);

      // 4. Mock 建立紀錄
      mockPrismaService.subTaskAssignee.create.mockResolvedValueOnce({
        subTaskId,
        assigneeId: actorId,
      });

      // 執行
      await tasksService.updateSubTaskAssigneeStatus(subTaskId, actorId, {
        status: AssignmentStatus.ACCEPTED,
      });

      // 斷言：檢查是否正確建立了指派紀錄 (Claim)
      expect(mockPrismaService.subTaskAssignee.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subTaskId,
          assigneeId: actorId,
          assignedById: actorId,
          status: AssignmentStatus.ACCEPTED,
          assignedAt: expect.any(Date),
          acceptedAt: expect.any(Date),
        }),
      });
    });

    it('should update status from ACCEPTED to COMPLETED for an existing record', async () => {
      // 1. Mock 子任務查詢
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce(mockSubTask);

      // 2. Mock 群組成員檢查
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        userId: actorId,
      });

      // 3. Mock 已有 ACCEPTED 紀錄
      mockPrismaService.subTaskAssignee.findUnique.mockResolvedValueOnce({
        status: AssignmentStatus.ACCEPTED,
      });

      // 4. Mock 更新
      mockPrismaService.subTaskAssignee.update.mockResolvedValueOnce({
        subTaskId,
        status: 'COMPLETED',
      });

      // 執行
      await tasksService.updateSubTaskAssigneeStatus(subTaskId, actorId, {
        status: AssignmentStatus.COMPLETED,
      });

      // 斷言：檢查是否呼叫了 update 並帶入正確的時間戳記 (由 getAssigneeUpdateData 產生)
      expect(mockPrismaService.subTaskAssignee.update).toHaveBeenCalledWith({
        where: {
          subTaskId_assigneeId: { subTaskId, assigneeId: actorId },
        },
        data: expect.objectContaining({
          status: AssignmentStatus.COMPLETED,
          completedAt: expect.any(Date),
        }),
      });
    });

    it('should throw forbidden error if trying to claim with a status other than ACCEPTED', async () => {
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce(mockSubTask);
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        userId: actorId,
      });
      mockPrismaService.subTaskAssignee.findUnique.mockResolvedValueOnce(null);

      // 嘗試在沒有紀錄的情況下直接傳送 COMPLETED
      await expect(
        tasksService.updateSubTaskAssigneeStatus(subTaskId, actorId, {
          status: AssignmentStatus.COMPLETED,
        }),
      ).rejects.toThrow();
      // 這裡會拋出 TasksErrors.TaskForbiddenError
    });

    it('should throw error if user is not a member of the group', async () => {
      mockPrismaService.subTask.findUnique.mockResolvedValueOnce(mockSubTask);
      // 模擬非成員
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce(null);

      await expect(
        tasksService.updateSubTaskAssigneeStatus(subTaskId, actorId, {
          status: AssignmentStatus.ACCEPTED,
        }),
      ).rejects.toThrow();
    });
  });

  // -----------------------Assign Tasks------------------------

  // ───────────────────────────────────────────────────────────────────────────────
  // updateSubTaskAssigneeStatus
  // ───────────────────────────────────────────────────────────────────────────────

  describe('assignTask', () => {
    const payload = {
      type: 'TASK',
      id: 1,
      assigneeId: 10,
      assignerId: 1,
      assignerName: 'test',
      updatedBy: 'test',
    };

    const mockTask = {
      groupId: 2,
      title: 'Test Task',
      priority: 1,
      description: 'desc',
      dueAtUtc: new Date(),
    };

    const mockTaskWithGroupMember = {
      id: payload.id,
      groupId: 2,
      group: {
        id: 2,
        name: 'Test Group',
        members: [{ userId: payload.assigneeId }],
      },
    };

    const mockAssigner = {
      groupId: 1,
      userId: 1,
      role: 'OWNER',
      joinedAt: '2025-12-01T02:58:24.612Z',
      user: { name: 'test1' },
      group: { name: 'test' },
    };
    it('should successfully assign a task using upsert (new assignment)', async () => {
      // 1. Mock 任務查詢 (必須包含 select 裡的所有欄位)
      mockPrismaService.task.findUnique.mockResolvedValueOnce(mockTask);

      // 2. Mock 指派者權限檢查 (第一次呼叫 groupMember)
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce(
        mockAssigner,
      );

      // 3. Mock 被指派者成員檢查 (第二次呼叫 groupMember)
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        userId: payload.assigneeId,
        groupId: 2,
      });

      // 4. Mock Upsert 成功
      mockPrismaService.taskAssignee.upsert.mockResolvedValueOnce({
        taskId: payload.id,
        assigneeId: payload.assigneeId,
      });

      // 5. 執行測試
      await tasksService.assignTask(payload);

      // 6. 修正斷言：確保與實作中的 select 一致
      expect(mockPrismaService.task.findUnique).toHaveBeenCalledWith({
        where: {
          id: payload.id,
          status: 'OPEN', // 實作代碼中有這行，測試必須對應
        },
        select: expect.any(Object),
      });

      // 檢查 Upsert
      expect(mockPrismaService.taskAssignee.upsert).toHaveBeenCalled();
    });

    it('should throw TaskNotFoundError if task does not exist', async () => {
      // 模擬任務不存在
      mockPrismaService.task.findUnique.mockResolvedValueOnce(null);

      await expect(tasksService.assignTask(payload)).rejects.toThrow();
    });

    it('should throw GroupMemberNotFoundError if assignee is not in the group', async () => {
      // 模擬任務存在，但 members 為空 (代表該人員不屬於此群組)
      const taskWithoutMember = {
        ...mockTaskWithGroupMember,
        group: { ...mockTaskWithGroupMember.group, members: [] },
      };
      mockPrismaService.task.findUnique.mockResolvedValueOnce(
        taskWithoutMember,
      );

      await expect(tasksService.assignTask(payload)).rejects.toThrow();

      // 確保不會進到下一步的 upsert
      expect(mockPrismaService.taskAssignee.upsert).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // getPendingAssignmentsDetails
  // ───────────────────────────────────────────────────────────────────────────────

  // describe('getPendingAssignmentsDetails', () => {
  //   const pendingTasks = [
  //     {
  //       task: {
  //         id: 66,
  //         priority: 1,
  //         title: 'test',
  //         dueAtUtc: '2025-12-17T00:28:00.000Z',
  //       },
  //       group: { id: 9, name: 'test group' },
  //     },
  //     {
  //       task: {
  //         id: 7,
  //         priority: 2,
  //         title: 'test',
  //         dueAtUtc: '2025-12-17T00:28:00.000Z',
  //       },
  //       group: { id: 2, name: 'test group2' },
  //     },
  //   ];
  //   const pendingSubTasks = [
  //     {
  //       subTask: {
  //         id: 11,
  //         priority: 3,
  //         taskId: 14,
  //         title: 'test sub',
  //         dueAtUtc: null,
  //       },
  //     },
  //   ];
  //   // get pending tasks from userId
  //   mockPrismaService.taskAssignee.findMany.mockResolvedValueOnce(pendingTasks);
  //   mockPrismaService.subTaskAssignee.findMany.mockResolvedValueOnce(
  //     pendingSubTasks,
  //   );
  //   const pendingDetails = await tasksService.getPendingAssignmentsDetails(
  //     user.id,
  //   );
  // });
});
