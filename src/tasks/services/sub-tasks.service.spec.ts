import { Test, TestingModule } from '@nestjs/testing';
import { AssignmentStatus } from 'src/generated/prisma/client';
import type {
  User as Usermodel,
  Task as TaskModel,
} from 'src/generated/prisma/client';
import { TaskStatus } from '../types/enum';
import { SubTasksService } from './sub-tasks.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { SubTaskAddPayload, TaskUpdatePayload } from '../types/tasks';
import { TasksErrors } from 'src/errors';
import { createMockUser } from 'src/test/factories/mock-user.factory';
import { createMockTask } from 'src/test/factories/mock-task.factory';
import { TasksHelperService } from './helper.service';
import { TaskAssignmentManager } from './task-assignment.service';
import { TasksUtils } from '../tasks.util';
import { CurrentUser } from 'src/common/types/current-user';

describe('SubsubTasksService', () => {
  let subTasksService: SubTasksService;

  const mockUsersService = { findByIdOrThrow: jest.fn(), findById: jest.fn() };
  const mockPrismaService = {
    $queryRaw: jest.fn(),
    user: {
      findUnique: jest.fn(),
    },
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
      upsert: jest.fn(),
      updateMany: jest.fn(),
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

  const mocktasksHelper = {
    notifyTaskChange: jest.fn(),
    notifySubTaskChange: jest.fn(),
  };
  const mockTaskAssignmentManager = {
    execute: jest.fn(),
  };

  const user: Usermodel = createMockUser();
  const lowTask: TaskModel = createMockTask();
  const currentUser: CurrentUser = {
    userId: user.id,
    userName: user.name,
    email: user.email,
    timeZone: user.timeZone,
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubTasksService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: TasksHelperService, useValue: mocktasksHelper },
        { provide: TaskAssignmentManager, useValue: mockTaskAssignmentManager },
      ],
    }).compile();

    subTasksService = module.get<SubTasksService>(SubTasksService);
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
  // create
  // ───────────────────────────────────────────────────────────────────────────────

  describe('createSubTask', () => {
    const actorId = 1;
    const parentTaskId = 100;

    const basePayload: SubTaskAddPayload = {
      parentTaskId: parentTaskId,
      actorId: actorId,
      title: 'New Subtask',
      description: 'Subtask description',
      location: 'Office',
      priority: 2,
      allDay: false,
      dueDate: '2024-05-20',
      dueTime: '14:00',
      status: 'OPEN' as const,
      updatedBy: 'test',
      timeZone: 'Asia/Taipei',
    };

    const mockActor = { id: actorId, timeZone: 'Asia/Taipei' };

    beforeEach(() => {
      // 預設模擬 calculateTaskDates 回傳值 (避免測試依賴日期算法細節)
      jest.spyOn(TasksUtils, 'calculateTaskDates').mockReturnValue({
        dueAtUtc: new Date('2024-05-20T06:00:00Z'),
        allDayLocalDate: null,
      });
    });

    describe('Permission Validation', () => {
      it('should throw TaskForbiddenError if trying to add subtask to a personal task not owned by actor', async () => {
        // 模擬個人任務，但 Owner 不是目前使用者
        mockPrismaService.task.findUnique.mockResolvedValue({
          id: parentTaskId,
          ownerId: 999, // Other user
          groupId: null,
        });
        mockPrismaService.user.findUnique.mockResolvedValue(mockActor);

        await expect(
          subTasksService.createSubTask(basePayload),
        ).rejects.toThrow(
          expect.objectContaining({
            action: 'CREATE_SUBTASK_ON_PERSONAL_TASK_NOT_OWNER',
          }),
        );
      });
    });

    describe('Core Logic & Database Interaction', () => {
      it('should successfully create a subtask with correctly mapped data', async () => {
        // 模擬合法的個人任務 Owner
        mockPrismaService.task.findUnique.mockResolvedValue({
          id: parentTaskId,
          ownerId: actorId,
          groupId: null,
        });
        mockPrismaService.user.findUnique.mockResolvedValue(mockActor);
        mockPrismaService.subTask.create.mockResolvedValue({ id: 1 });

        await subTasksService.createSubTask(basePayload);

        // 驗證日期計算被正確呼叫
        expect(TasksUtils.calculateTaskDates).toHaveBeenCalledWith(
          basePayload.allDay,
          basePayload.dueDate,
          basePayload.dueTime,
          mockActor.timeZone,
        );

        // 驗證 Prisma Create 被正確呼叫
        expect(mockPrismaService.subTask.create).toHaveBeenCalledWith({
          data: {
            title: basePayload.title,
            description: basePayload.description,
            location: basePayload.location,
            status: 'OPEN',
            priority: 2,
            allDay: false,
            dueAtUtc: expect.any(Date),
            allDayLocalDate: null,
            task: { connect: { id: parentTaskId } },
          },
        });
      });

      it('should default priority to 3 if not provided in payload', async () => {
        mockPrismaService.task.findUnique.mockResolvedValue({
          id: parentTaskId,
          ownerId: actorId,
          groupId: null,
        });
        mockPrismaService.user.findUnique.mockResolvedValue(mockActor);

        const { priority, ...payloadWithoutPriority } = basePayload;

        await subTasksService.createSubTask(payloadWithoutPriority as any);

        expect(mockPrismaService.subTask.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              priority: 3,
            }),
          }),
        );
      });
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
      const result = await subTasksService.getSubTaskForViewer(
        personalParentTask.id,
        mockSubTask.id,
        user.id,
      );

      // 5. 斷言 - 檢查查詢結構 (與實作代碼的 include 內容一致)
      expect(mockPrismaService.subTask.findUnique).toHaveBeenCalledWith({
        where: { id: mockSubTask.id },
        include: {
          task: { select: { id: true, groupId: true, ownerId: true } },
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
        isRealAdmin: true,
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
      const result = await subTasksService.getSubTaskForViewer(
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
        isRealAdmin: false,
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

      const result = await subTasksService.getSubTaskForViewer(
        lowTask.id,
        999,
        user.id,
      );

      expect(result).toEqual({
        groupMembers: [],
        isRealAdmin: true,
        isAdminish: true,
        subTask: [],
      });
    });

    it('should throw TaskNotFoundError if parent task not found', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(null);

      await expect(
        subTasksService.getSubTaskForViewer(999, 1, user.id),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);

      expect(mockPrismaService.subTask.findFirst).not.toHaveBeenCalled();
    });

    it('should throw TaskNotFoundError if a personal parent task exists and actor not owner', async () => {
      mockPrismaService.task.findUnique.mockResolvedValueOnce(lowTask);

      await expect(
        subTasksService.getSubTaskForViewer(lowTask.id, 1, 999),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);

      expect(mockPrismaService.subTask.findFirst).not.toHaveBeenCalled();
    });

    it('should throw TaskNotFoundError if a group parent task exists and actor not member', async () => {
      const parentTask = { ...lowTask, groupId: 5 };
      mockPrismaService.task.findUnique.mockResolvedValueOnce(parentTask);
      // 模擬 actor 不是 group member
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce(null);

      await expect(
        subTasksService.getSubTaskForViewer(lowTask.id, 1, 999),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);

      expect(mockPrismaService.subTask.findFirst).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // updateSubTask
  // ───────────────────────────────────────────────────────────────────────────────

  describe('updateSubTask', () => {
    const mockActorId = 1;
    const mockSubTaskId = 101;
    const mockActorTz = 'Asia/Taipei';
    const mockPayload: TaskUpdatePayload = {
      title: 'Updated SubTask Title',
      priority: 1,
    };

    it('should throw TaskNotFoundError if subTask does not exist', async () => {
      mockPrismaService.subTask.findUnique.mockResolvedValue(null);

      await expect(
        subTasksService.updateSubTask(
          mockSubTaskId,
          mockActorId,
          mockActorTz,
          mockPayload,
        ),
      ).rejects.toThrow(TasksErrors.TaskNotFoundError);
    });

    it('should successfully update and notify when all checks pass (Group Task)', async () => {
      // 1. 模擬權限校驗通過
      mockPrismaService.subTask.findUnique.mockResolvedValue({
        id: mockSubTaskId,
        taskId: 50,
        task: {
          id: 50,
          ownerId: 99,
          groupId: 200,
          group: { members: [{ role: 'MEMBER' }] },
        },
      });

      // 2. 模擬 update 成功
      mockPrismaService.subTask.update.mockResolvedValue({
        id: mockSubTaskId,
        taskId: 50,
      });

      // 執行
      await subTasksService.updateSubTask(
        mockSubTaskId,
        mockActorId,
        mockActorTz,
        mockPayload,
      );

      // 3. 驗證資料處理 (getCommonUpdateData 的產出應該被帶入 update)
      expect(mockPrismaService.subTask.update).toHaveBeenCalledWith({
        where: { id: mockSubTaskId },
        data: expect.objectContaining({
          title: mockPayload.title,
          priority: Number(mockPayload.priority),
        }),
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // closeSubTask
  // ───────────────────────────────────────────────────────────────────────────────

  describe('closeSubTask', () => {
    const parentId = 100;
    const subTaskId = 200;
    const mockCurrentUser = {
      userId: 1,
      userName: 'testUser',
      timeZone: 'Asia/Taipei',
    };

    it('should throw TaskNotFoundError if subTask does not exist', async () => {
      // Arrange: 模擬資料庫找不到該子任務
      mockPrismaService.subTask.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        subTasksService.closeSubTask(
          parentId,
          subTaskId,
          mockCurrentUser as any,
        ),
      ).rejects.toThrow(TasksErrors.TaskNotFoundError);

      // 驗證沒進到交易流程
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should successfully close subTask and self-claim if actor is not yet completed', async () => {
      // Arrange
      // 1. 模擬基礎檢查通過
      mockPrismaService.subTask.findUnique.mockResolvedValue({ id: subTaskId });
      // 2. 模擬更新子任務成功
      const mockUpdatedSubTask = { id: subTaskId, status: TaskStatus.CLOSED };
      mockPrismaService.subTask.update.mockResolvedValue(mockUpdatedSubTask);
      // 3. 模擬使用者目前並非完成者
      mockPrismaService.subTaskAssignee.findUnique.mockResolvedValue(null);

      // Act
      const result = await subTasksService.closeSubTask(
        parentId,
        subTaskId,
        mockCurrentUser as any,
        { reason: 'Mission accomplished' },
      );

      // Assert
      // 驗證子任務狀態更新
      expect(mockPrismaService.subTask.update).toHaveBeenCalledWith({
        where: { id: subTaskId },
        data: expect.objectContaining({
          status: TaskStatus.CLOSED,
          closedById: mockCurrentUser.userId,
          closedReason: 'Mission accomplished',
        }),
      });

      // 驗證觸發了自我認領 (upsert)
      expect(mockPrismaService.subTaskAssignee.upsert).toHaveBeenCalled();

      // 驗證清理了其他人的狀態 (ACCEPTED -> DROPPED, PENDING -> SKIPPED)
      expect(
        mockPrismaService.subTaskAssignee.updateMany,
      ).toHaveBeenCalledTimes(2);
      expect(mockPrismaService.subTaskAssignee.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { subTaskId, status: AssignmentStatus.ACCEPTED },
        }),
      );

      // 驗證 Socket 通知
      expect(mocktasksHelper.notifyTaskChange).toHaveBeenCalledWith(
        parentId,
        mockCurrentUser.userId,
        mockCurrentUser.userName,
        'CLOSE_SUBTASK',
      );

      expect(result).toEqual(mockUpdatedSubTask);
    });

    it('should not call upsert if actor is already in COMPLETED status', async () => {
      // Arrange
      mockPrismaService.subTask.findUnique.mockResolvedValue({ id: subTaskId });
      // 模擬使用者已經是 COMPLETED
      mockPrismaService.subTaskAssignee.findUnique.mockResolvedValue({
        status: AssignmentStatus.COMPLETED,
      });

      // Act
      await subTasksService.closeSubTask(
        parentId,
        subTaskId,
        mockCurrentUser as any,
      );

      // Assert
      // 應該只查詢，不更新 (因為 if 條件不成立)
      expect(mockPrismaService.subTaskAssignee.upsert).not.toHaveBeenCalled();
      // 但其他的清理動作還是要執行
      expect(mockPrismaService.subTaskAssignee.updateMany).toHaveBeenCalled();
    });

    it('should handle missing reason by setting it to null', async () => {
      // Arrange
      mockPrismaService.subTask.findUnique.mockResolvedValue({ id: subTaskId });
      mockPrismaService.subTaskAssignee.findUnique.mockResolvedValue(null);

      // Act
      await subTasksService.closeSubTask(
        parentId,
        subTaskId,
        mockCurrentUser as any,
      );

      // Assert
      expect(mockPrismaService.subTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            closedReason: null,
          }),
        }),
      );
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

      await subTasksService.updateSubTaskStatus(subTaskId, {
        newStatus: TaskStatus.CLOSED,
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

      await subTasksService.updateSubTaskStatus(subTaskId, {
        newStatus: TaskStatus.OPEN,
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

      await subTasksService.updateSubTaskStatus(subTaskId, {
        newStatus: TaskStatus.ARCHIVED,
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
        subTasksService.updateSubTaskStatus(subTaskId, {
          newStatus: TaskStatus.CLOSED,
          actorId,
        }),
      ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);

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
        subTasksService.updateSubTaskStatus(subTaskId, {
          newStatus: TaskStatus.CLOSED,
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
      const parentId = 11;
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

      const result = await subTasksService.restoreSubTask(
        parentId,
        subTaskId,
        currentUser,
      );

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
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // updateSubTaskAssigneeStatus
  // ───────────────────────────────────────────────────────────────────────────────

  describe('updateSubTaskAssigneeStatus', () => {
    const actorId = 1;
    const parentId = 11;
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
      await subTasksService.updateSubTaskAssigneeStatus(
        parentId,
        subTaskId,
        currentUser,
        {
          status: AssignmentStatus.ACCEPTED,
        },
      );

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
      await subTasksService.updateSubTaskAssigneeStatus(
        parentId,
        subTaskId,
        currentUser,
        {
          status: AssignmentStatus.COMPLETED,
        },
      );

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
        subTasksService.updateSubTaskAssigneeStatus(
          parentId,
          subTaskId,
          currentUser,
          {
            status: AssignmentStatus.COMPLETED,
          },
        ),
      ).rejects.toThrow();
      // 這裡會拋出 TasksErrors.TaskForbiddenError
    });
  });

  // -----------------------Assign Tasks------------------------

  // ───────────────────────────────────────────────────────────────────────────────
  // updateSubTaskAssigneeStatus
  // ───────────────────────────────────────────────────────────────────────────────

  describe('assignSubTask', () => {
    it('should delegate sub-task assignment to TaskAssignmentManager', async () => {
      const payload = {
        id: 50,
        assigneeId: 1,
        assignerName: 'test',
        assignerId: 2,
        sendUrgentEmail: true,
      };

      // 1. 執行 Service 方法
      await subTasksService.assignSubTask(payload);

      // 2. 驗證 Manager 的 execute 方法是否有被呼叫，且參數正確
      expect(mockTaskAssignmentManager.execute).toHaveBeenCalledWith({
        type: 'SUBTASK',
        targetId: payload.id,
        assigneeId: payload.assigneeId,
        assignerId: payload.assignerId,
        sendUrgentEmail: payload.sendUrgentEmail,
      });
    });
  });
});
