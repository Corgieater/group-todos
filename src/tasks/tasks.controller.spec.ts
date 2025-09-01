import { Test, TestingModule } from '@nestjs/testing';
import { Task } from '@prisma/client';
import { TasksController } from './tasks.controller';
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
  let tasksController: TasksController;
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
      controllers: [TasksController],
      providers: [{ provide: TasksService, useValue: mockTasksSerivce }],
    }).compile();

    tasksController = module.get<TasksController>(TasksController);
  });

  describe('add task', () => {
    let dto: TasksAddDto;

    beforeEach(() => {
      dto = {
        title: 'test',
        location: 'test',
      };
    });

    it('should add task and redirect with success message', async () => {
      await tasksController.addTask(req, currentUser, dto, res);
      const payload = {
        title: dto.title,
        status: null,
        priority: null,
        description: null,
        dueAt: null,
        location: dto.location ?? null,
        userId: currentUser.userId,
      };
      expect(mockTasksSerivce.addTask).toHaveBeenCalledWith(payload);
      expect(req.session.flash).toEqual({
        type: 'success',
        message: 'Task added',
      });
      expect(res.redirect).toHaveBeenCalledWith('/');
    });
  });
});
