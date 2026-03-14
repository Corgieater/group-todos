import { Test, TestingModule } from '@nestjs/testing';
import { SubTasksController } from './sub-tasks.controller';
import { CompletionPolicy } from 'src/generated/prisma/enums';
import type { Task, User as UserModel } from 'src/generated/prisma/client';
import { SubTasksAddDto, UpdateTaskDto } from '../dto/tasks.dto';
import { TaskStatus } from '../types/enum';
import { Request, Response } from 'express';
import {
  createMockReq,
  createMockRes,
} from 'src/test/factories/mock-http.factory';
import { CurrentUser } from 'src/common/types/current-user';
import { createMockUser } from 'src/test/factories/mock-user.factory';

jest.mock('src/common/helpers/flash-helper', () => ({ setSession: jest.fn() }));
import { setSession } from 'src/common/helpers/flash-helper';
import { TaskPriority } from '../types/enum';
import { SecurityService } from 'src/security/security.service';
import { createMockSecurityService } from 'src/test/factories/mock-security.service';
import { TaskContext } from '../types/tasks';
import { PrismaService } from 'src/prisma/prisma.service';
import { TaskAssignmentManager } from '../services/task-assignment.service';
import { SubTasksService } from '../services/sub-tasks.service';

describe('SubsubTasksController', () => {
  let subTasksController: SubTasksController;
  let user: UserModel;
  let req: Request;
  let res: Response;
  let currentUser: CurrentUser;
  let taskContext: TaskContext;
  let task: Task;

  const mockSubTasksService = {
    createSubTask: jest.fn(),
    getAllTasks: jest.fn(),
    updateSubTask: jest.fn(),
    closeTask: jest.fn(),
    archiveTask: jest.fn(),
    deleteTask: jest.fn(),
  };

  const mockSecurityService = createMockSecurityService();
  const mockPrismaService = {};
  const mockTaskAssignmentManager = {};

  beforeAll(async () => {
    user = createMockUser();
    req = createMockReq();
    res = createMockRes();

    currentUser = {
      userId: user.id,
      userName: user.name,
      email: user.email,
      timeZone: user.timeZone,
    };

    taskContext = {
      task: {
        id: 1,
        ownerId: 1,
        groupId: 1,
        status: TaskStatus.OPEN,
      } as Task,
      userId: currentUser.userId,
      isAdminish: true,
      isMember: true,
      isOwner: true,
    };
    task = {
      id: 1,
      groupId: null,
      ownerId: user.id,
      title: 'walk cat',
      status: TaskStatus.OPEN,
      priority: 1,
      description: null,
      location: null,
      dueAtUtc: null,
      allDay: false,
      allDayLocalDate: null,
      sourceTimeZone: null,
      completionPolicy: CompletionPolicy.ALL_ASSIGNEES,
      closedAt: null,
      closedById: null,
      closedReason: null,
      closedWithOpenAssignees: false,
      createdAt: new Date('2025-09-01T05:46:07.462Z'),
      updatedAt: new Date('2025-09-06T10:28:48.368Z'),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubTasksController],
      providers: [
        { provide: SubTasksService, useValue: mockSubTasksService },
        {
          provide: SecurityService,
          useValue: mockSecurityService,
        },
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: TaskAssignmentManager,
          useValue: mockTaskAssignmentManager,
        },
      ],
    }).compile();

    subTasksController = module.get<SubTasksController>(SubTasksController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // create
  // ───────────────────────────────────────────────────────────────────────────────

  describe('create', () => {
    let dto1: SubTasksAddDto;
    let dto2: SubTasksAddDto;

    beforeEach(() => {
      dto1 = {
        title: 'test1',
        status: undefined,
        priority: undefined,
        description: undefined,
        dueDate: undefined,
        allDay: true,
        dueTime: undefined,
        location: undefined,
        parentTaskId: task.id,
      };

      dto2 = {
        title: 'test2',
        status: TaskStatus.OPEN,
        priority: TaskPriority.HIGH,
        description: 'test2',
        dueDate: '2025-09-09',
        allDay: true,
        dueTime: undefined,
        location: 'test2',
        parentTaskId: task.id,
      };
    });

    it('should normalize optional empty fields to null before calling service, set success message and redirect', async () => {
      await subTasksController.create(req, currentUser, taskContext, dto1, res);

      const payload = {
        actorId: 1,
        title: 'test1',
        status: null,
        priority: null,
        description: null,
        dueDate: null,
        allDay: true,
        dueTime: null,
        location: null,
        parentTaskId: 1,
        updatedBy: 'test',
        timeZone: 'Asia/Taipei',
      };

      expect(mockSubTasksService.createSubTask).toHaveBeenCalledWith(payload);
      expect(setSession).toHaveBeenCalledWith(req, 'success', 'Sub-task added');
      expect(res.redirect).toHaveBeenCalledWith('/tasks/1');
    });

    it('should create an all-day task when dueDate is provided and dueTime is omitted', async () => {
      await subTasksController.create(req, currentUser, taskContext, dto2, res);
      const payload = {
        actorId: 1,
        title: 'test2',
        status: TaskStatus.OPEN,
        priority: 2,
        description: 'test2',
        dueDate: '2025-09-09',
        allDay: true,
        dueTime: null,
        location: 'test2',
        parentTaskId: 1,
        updatedBy: 'test',
        timeZone: 'Asia/Taipei',
      };

      expect(mockSubTasksService.createSubTask).toHaveBeenCalledWith(payload);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // update
  // ───────────────────────────────────────────────────────────────────────────────
  //   describe('update', () => {
  //     let dto: UpdateTaskDto;

  //     beforeEach(() => {
  //       dto = {
  //         title: 'new title',
  //         allDay: false,
  //         dueDate: '2025-09-09',
  //         dueTime: '13:39',
  //       };
  //     });

  //     it('should update task', async () => {
  //       mockSubTasksService.updateSubTask.mockResolvedValueOnce({
  //         ...task,
  //         title: 'new title',
  //         allDay: false,
  //         dueAtUtc: '2025-09-17T13:39:00.000Z',
  //       });
  //       await subTasksController.update(req, dto, currentUser, taskContext, res);

  //       expect(mockSubTasksService.updateSubTask).toHaveBeenCalledWith(
  //         {
  //           id: 1,
  //           isAdminish: true,
  //           isOwner: true,
  //           timeZone: 'Asia/Taipei',
  //           userId: 1,
  //           userName: 'test',
  //         },
  //         dto,
  //       );
  //       expect(setSession).toHaveBeenCalledWith(
  //         req,
  //         'success',
  //         'Task has been updated',
  //       );
  //       expect(res.redirect).toHaveBeenCalledWith('/tasks/1');
  //     });
  //   });

  // ───────────────────────────────────────────────────────────────────────────────
  // close (should deal with force close first)
  // ───────────────────────────────────────────────────────────────────────────────

  //   describe('close', () => {
  //     it('should redirect on successful traditional form submission', async () => {
  //       const req = { headers: {} } as any; // Not an AJAX request
  //       await subTasksController.close(
  //         66,
  //         {},
  //         currentUser,
  //         taskContext,
  //         res,
  //         req,
  //       );

  //       expect(mockSubTasksService.closeTask).toHaveBeenCalledWith(
  //         {
  //           id: 66,
  //           isAdminish: true,
  //           isOwner: true,
  //           userId: 1,
  //           userName: 'test',
  //         },
  //         { reason: undefined },
  //       );
  //       expect(res.redirect).toHaveBeenCalledWith('/tasks/66');
  //     });

  //     it('should return JSON 200 on successful AJAX request', async () => {
  //       const req = { headers: { accept: 'application/json' } } as any;
  //       await subTasksController.close(
  //         66,
  //         { reason: 'Done' },
  //         currentUser,
  //         taskContext,
  //         res,
  //         req,
  //       );

  //       expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
  //       expect(res.json).toHaveBeenCalledWith({ success: true });
  //     });

  //     it('should return JSON 403 with action FORCE_CLOSE_REASON_REQUIRED if service throws it', async () => {
  //       const forceCloseError = {
  //         action: 'FORCE_CLOSE_REASON_REQUIRED',
  //         message: 'Need reason',
  //       };
  //       mockSubTasksService.closeTask.mockRejectedValueOnce(forceCloseError);
  //       const req = { headers: { accept: 'application/json' } } as any;
  //       await subTasksController.close(
  //         66,
  //         {},
  //         currentUser,
  //         taskContext,
  //         res,
  //         req,
  //       );

  //       expect(res.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
  //       expect(res.json).toHaveBeenCalledWith({
  //         success: false,
  //         action: 'FORCE_CLOSE_REASON_REQUIRED',
  //         message: expect.any(String),
  //       });
  //     });

  //     it('should return JSON 400 on standard forbidden error', async () => {
  //       const forbiddenError = {
  //         status: 400,
  //         message: 'You do not have permission',
  //       };
  //       mockSubTasksService.closeTask.mockRejectedValueOnce(forbiddenError);

  //       const req = { headers: { accept: 'application/json' } } as any;
  //       await subTasksController.close(
  //         66,
  //         {},
  //         currentUser,
  //         taskContext,
  //         res,
  //         req,
  //       );

  //       expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
  //       expect(res.json).toHaveBeenCalledWith({
  //         success: false,
  //         message: 'You do not have permission',
  //       });
  //     });
  //   });

  //   // ───────────────────────────────────────────────────────────────────────────────
  //   // archiveTask
  //   // ───────────────────────────────────────────────────────────────────────────────
  //   describe('archiveTask', () => {
  //     it('should archive task', async () => {
  //       await subTasksController.archiveTask(
  //         req,
  //         currentUser,
  //         taskContext,
  //         1,
  //         res,
  //       );

  //       expect(mockSubTasksService.archiveTask).toHaveBeenCalledWith(
  //         1,
  //         1,
  //         true,
  //         true,
  //         'test',
  //       );
  //       expect(setSession).toHaveBeenCalledWith(
  //         req,
  //         'success',
  //         'Task has been archived.',
  //       );
  //       expect(res.redirect).toHaveBeenCalledWith('/tasks/1');
  //     });
  //   });
});
