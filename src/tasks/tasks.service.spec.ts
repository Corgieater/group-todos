import { Test, TestingModule } from '@nestjs/testing';
import { Status, User as Usermodel, Task as TaskModel } from '@prisma/client';
import { TasksService } from './tasks.service';
import { createMockUser } from 'src/test/factories/mock-user.factory';
import { UsersService } from 'src/users/users.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { TasksAddPayload } from './types/tasks';
import { TaskPriority } from './types/enum';
import { TasksErrors, UsersErrors } from 'src/errors';
import { createMockTask } from 'src/test/factories/mock-task.factory';

describe('TasksService', () => {
  let tasksService: TasksService;

  const mockUsersService = { findByIdOrThrow: jest.fn() };
  const mockPrismaService = {
    task: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  };
  const user: Usermodel = createMockUser();
  const lowTask: TaskModel = createMockTask();
  const mediumTask: TaskModel = createMockTask({
    id: 2,
    title: 'medium test',
    priority: 3,
  });
  const urgentTask: TaskModel = createMockTask({
    id: 3,
    title: 'urgent test',
    priority: 1,
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    tasksService = module.get<TasksService>(TasksService);

    mockUsersService.findByIdOrThrow.mockResolvedValue(user);
  });

  describe('addTask', () => {
    let payload: TasksAddPayload;
    beforeEach(() => {
      payload = {
        title: 'task',
        status: null,
        priority: null,
        description: null,
        dueAt: null,
        location: null,
        userId: user.id,
      };
    });

    it('should create a task with default values when optional fields are null', async () => {
      await tasksService.addTask(payload);
      expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(
        payload.userId,
      );
      expect(mockPrismaService.task.create).toHaveBeenCalledWith({
        data: {
          title: 'task',
          description: null,
          dueAt: null,
          allDay: false,
          location: null,
          userId: user.id,
        },
      });

      expect(mockPrismaService.task.create).toHaveBeenCalledTimes(1);
    });

    it('should create a task with dueAt, status, and priority when provided', async () => {
      payload['dueAt'] = '2025-06-06T09:00:00Z';
      payload['status'] = Status.FINISHED;
      payload['priority'] = TaskPriority.HIGH;
      await tasksService.addTask(payload);
      expect(mockPrismaService.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          dueAt: new Date('2025-06-06T09:00:00Z'),
          status: Status.FINISHED,
          allDay: false,
          priority: TaskPriority.HIGH,
        }),
      });
    });

    it('should throw userNotFoundError', async () => {
      mockUsersService.findByIdOrThrow.mockRejectedValueOnce(
        UsersErrors.UserNotFoundError.byId(user.id),
      );
      mockUsersService.findByIdOrThrow.mockRejectedValueOnce(
        UsersErrors.UserNotFoundError.byId(user.id),
      );
      // TODO:
      // search 'toThrow' change stuff like this
      await expect(tasksService.addTask(payload)).rejects.toBeInstanceOf(
        UsersErrors.UserNotFoundError,
      );

      await expect(tasksService.addTask(payload)).rejects.toThrow(
        'User was not found',
      );
    });
  });

  describe('getAllTasks', () => {
    let data: TaskModel[];
    beforeEach(() => {
      data = [urgentTask, mediumTask, lowTask];
    });

    it('should return all tesks', async () => {
      mockPrismaService.task.findMany.mockReturnValueOnce(data);
      const tasks = await tasksService.getAllTasks(user.id);
      expect(mockPrismaService.task.findMany).toHaveBeenCalledWith({
        where: { userId: user.id, status: Status.UNFINISHED },
        orderBy: { priority: 'asc' },
      });
      expect(tasks.length).toBeGreaterThan(0);
    });

    it('should throw userNotFoundError', async () => {
      mockUsersService.findByIdOrThrow.mockRejectedValueOnce(
        UsersErrors.UserNotFoundError.byId(user.id),
      );
      mockUsersService.findByIdOrThrow.mockRejectedValueOnce(
        UsersErrors.UserNotFoundError.byId(user.id),
      );
      await expect(tasksService.getAllTasks(user.id)).rejects.toBeInstanceOf(
        UsersErrors.UserNotFoundError,
      );

      await expect(tasksService.getAllTasks(user.id)).rejects.toThrow(
        'User was not found',
      );
    });

    describe('getTaskById', () => {
      it('should get taks details by id', async () => {
        mockPrismaService.task.findUnique.mockResolvedValueOnce(lowTask);
        const task = await tasksService.getTaskById(user.id, lowTask.id);
        expect(mockPrismaService.task.findUnique).toHaveBeenCalledWith({
          where: { userId: user.id, id: lowTask.id },
        });
        expect(task).toMatchObject({
          id: lowTask.id,
          title: 'low test',
          status: Status.UNFINISHED,
          priority: TaskPriority.LOW,
          location: 'test',
          description: 'test',
          dueAt: null,
          createdAt: new Date('2025-09-01T05:49:55.797Z'),
        });
      });

      it('should throw TaskNotFoundError', async () => {
        mockPrismaService.task.findUnique.mockReturnValueOnce(null);
        await expect(
          tasksService.getTaskById(999, lowTask.id),
        ).rejects.toBeInstanceOf(TasksErrors.TaskNotFoundError);
      });
    });
  });
});
