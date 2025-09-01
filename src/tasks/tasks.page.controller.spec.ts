import { Test, TestingModule } from '@nestjs/testing';
import { Task } from '@prisma/client';
import { TasksPageController } from './tasks.page.controller';
import { TasksAddDto } from './dto/tasks.dto';
import { TasksService } from './tasks.service';
import { Request, Response } from 'express';
import {
  createMockReq,
  createMockRes,
} from 'src/test/factories/mock-http.factory';
import { CurrentUser } from 'src/common/types/current-user';
import { User as userModel } from '@prisma/client';
import { createMockUser } from 'src/test/factories/mock-user.factory';
import { TaskPriority } from './types/enum';

describe('TasksController', () => {
  let tasksPageController: TasksPageController;
  let user: userModel;
  let req: Request;
  let res: Response;
  let currentUser: CurrentUser;

  const mockTasksSerivce = { addTask: jest.fn(), getAllTasks: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    user = createMockUser();
    req = createMockReq();
    res = createMockRes();

    currentUser = {
      userId: user.id,
      userName: user.name,
      email: user.email,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksPageController],
      providers: [{ provide: TasksService, useValue: mockTasksSerivce }],
    }).compile();

    tasksPageController = module.get<TasksPageController>(TasksPageController);
  });

  describe('getAllTasks', () => {
    let data: Task[];
    beforeEach(() => {
      data = [
        {
          id: 4,
          title: 'test',
          status: 'UNFINISHED',
          priority: 1,
          description: null,
          dueAt: null,
          allDay: false,
          location: null,
          userId: 1,
          createdAt: new Date('2025-09-01T05:49:55.797Z'),
          updatedAt: new Date('2025-09-01T05:49:55.797Z'),
        },
        {
          id: 3,
          title: 'test',
          status: 'UNFINISHED',
          priority: 3,
          description: null,
          dueAt: null,
          allDay: false,
          location: null,
          userId: 1,
          createdAt: new Date('2025-09-01T05:46:07.462Z'),
          updatedAt: new Date('2025-09-01T05:46:07.462Z'),
        },
      ];
    });

    it('should get all tasks and render home page', async () => {
      mockTasksSerivce.getAllTasks.mockResolvedValueOnce(data);

      await tasksPageController.home(currentUser, res);
      expect(mockTasksSerivce.getAllTasks).toHaveBeenCalledWith(
        currentUser.userId,
      );
      expect(mockTasksSerivce.getAllTasks).toHaveBeenCalledTimes(1);
      expect(res.render).toHaveBeenCalledWith('tasks/home', {
        name: currentUser.userName,
        tasks: data,
      });
    });
  });
});
