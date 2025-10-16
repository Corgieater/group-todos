import { Test, TestingModule } from '@nestjs/testing';
import { TasksController } from './tasks.controller';
import type { Task, User as UserModel } from '@prisma/client';
import { TasksAddDto, UpdateTaskDto } from './dto/tasks.dto';
import { TaskStatus } from './types/enum';
import { TasksService } from './tasks.service';
import { Request, Response } from 'express';
import {
  createMockReq,
  createMockRes,
} from 'src/test/factories/mock-http.factory';
import { CurrentUser } from 'src/common/types/current-user';
import { createMockUser } from 'src/test/factories/mock-user.factory';

jest.mock('src/common/helpers/flash-helper', () => ({ setSession: jest.fn() }));
import { setSession } from 'src/common/helpers/flash-helper';
import { TaskPriority } from './types/enum';

describe('TasksController', () => {
  let tasksController: TasksController;
  let user: UserModel;
  let req: Request;
  let res: Response;
  let currentUser: CurrentUser;
  let task: Task;

  const mockTasksService = {
    createTask: jest.fn(),
    getAllTasks: jest.fn(),
    updateTask: jest.fn(),
    updateTaskStatus: jest.fn(),
    deleteTask: jest.fn(),
  };

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

    task = {
      id: 1,
      groupId: null,
      ownerId: user.id,
      title: 'walk cat',
      status: TaskStatus.UNFINISHED,
      priority: 1,
      description: null,
      location: null,
      dueAtUtc: null,
      allDay: false,
      allDayLocalDate: null,
      sourceTimeZone: null,
      createdAt: new Date('2025-09-01T05:46:07.462Z'),
      updatedAt: new Date('2025-09-06T10:28:48.368Z'),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [{ provide: TasksService, useValue: mockTasksService }],
    }).compile();

    tasksController = module.get<TasksController>(TasksController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // create
  // ───────────────────────────────────────────────────────────────────────────────

  describe('create', () => {
    let dto1: TasksAddDto;
    let dto2: TasksAddDto;

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
      };

      dto2 = {
        title: 'test2',
        status: TaskStatus.UNFINISHED,
        priority: TaskPriority.HIGH,
        description: 'test2',
        dueDate: '2025-09-09',
        allDay: true,
        dueTime: undefined,
        location: 'test2',
      };
    });

    it('should normalize optional empty fields to null before calling service, set success message and redirect', async () => {
      await tasksController.create(req, currentUser, dto1, res);

      const payload = {
        title: 'test1',
        status: null,
        priority: null,
        description: null,
        dueDate: null,
        allDay: true,
        dueTime: null,
        location: null,
        userId: 1,
      };

      expect(mockTasksService.createTask).toHaveBeenCalledWith(payload);
      expect(setSession).toHaveBeenCalledWith(req, 'success', 'Task added');
      expect(res.redirect).toHaveBeenCalledWith('/tasks/home');
    });

    it('should create an all-day task when dueDate is provided and dueTime is omitted', async () => {
      await tasksController.create(req, currentUser, dto2, res);
      const payload = {
        title: 'test2',
        status: TaskStatus.UNFINISHED,
        priority: 2,
        description: 'test2',
        dueDate: '2025-09-09',
        allDay: true,
        dueTime: null,
        location: 'test2',
        userId: 1,
      };

      expect(mockTasksService.createTask).toHaveBeenCalledWith(payload);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // update
  // ───────────────────────────────────────────────────────────────────────────────

  describe('update', () => {
    let dto: UpdateTaskDto;

    beforeEach(() => {
      dto = {
        title: 'new title',
        allDay: false,
        dueDate: '2025-09-09',
        dueTime: '13:39',
      };
    });

    it('should update task', async () => {
      mockTasksService.updateTask.mockResolvedValueOnce({
        ...task,
        title: 'new title',
        allDay: false,
        dueAtUtc: '2025-09-17T13:39:00.000Z',
      });
      await tasksController.update(req, dto, currentUser, 1, res);

      expect(mockTasksService.updateTask).toHaveBeenCalledWith(
        1,
        currentUser.userId,
        dto,
      );
      expect(setSession).toHaveBeenCalledWith(
        req,
        'success',
        'Task has been updated',
      );
      expect(res.redirect).toHaveBeenCalledWith('/tasks/1');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // updateStatus
  // ───────────────────────────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('should update task status', async () => {
      await tasksController.updateStatus(
        req,
        TaskStatus.FINISHED,
        currentUser,
        1,
        res,
      );

      expect(mockTasksService.updateTaskStatus).toHaveBeenCalledWith(
        1,
        1,
        'FINISHED',
      );
      expect(setSession).toHaveBeenCalledWith(
        req,
        'success',
        'Status has been changed.',
      );
      expect(res.redirect).toHaveBeenCalledWith('/tasks/home');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // delete
  // ───────────────────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('should delete task', async () => {
      await tasksController.delete(req, currentUser, 1, res);

      expect(mockTasksService.deleteTask).toHaveBeenCalledWith(1, 1);
      expect(setSession).toHaveBeenCalledWith(
        req,
        'success',
        'Task has been deleted.',
      );
      expect(res.redirect).toHaveBeenCalledWith('/tasks/home');
    });
  });
});
