import { Test, TestingModule } from '@nestjs/testing';
import { Status, Priority } from '@prisma/client';
import { TasksService } from './tasks.service';
import { createMockUser } from 'src/test/factories/mock-user.factory';
import { User as Usermodel } from '@prisma/client';
import { UsersService } from 'src/users/users.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { TasksAddPayload } from './types/tasks';

describe('TasksService', () => {
  let tasksService: TasksService;

  const mockUsersService = { findById: jest.fn() };
  const mockPrismaService = { task: { create: jest.fn() } };
  const user: Usermodel = createMockUser();

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
      payload['priority'] = Priority.HIGH;
      await tasksService.addTask(payload);
      expect(mockPrismaService.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          dueAt: new Date('2025-06-06T09:00:00Z'),
          status: Status.FINISHED,
          allDay: false,
          priority: Priority.HIGH,
        }),
      });
    });
  });
});
