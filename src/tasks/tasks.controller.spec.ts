import { Test, TestingModule } from '@nestjs/testing';
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

describe('TasksController', () => {
  let taskController: TasksController;

  const mockTasksSerivce = { addTask: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [{ provide: TasksService, useValue: mockTasksSerivce }],
    }).compile();

    taskController = module.get<TasksController>(TasksController);
  });

  describe('add task', () => {
    let dto: TasksAddDto;
    const req: Request = createMockReq();
    const res: Response = createMockRes();
    const user: userModel = createMockUser();
    let currentUser: CurrentUser;

    beforeEach(() => {
      dto = {
        title: 'test',
        location: 'test',
      };
      currentUser = {
        userId: user.id,
        userName: user.name,
        email: user.email,
      };
    });

    it('should add task and redirect with success message', async () => {
      await taskController.addTask(req, currentUser, dto, res);
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

  // describe('getAllTasks', () => {
  //   it('should get all tasks', () => {
  //     await mockTasksSerivce.getAllTasks(user.id);
  //   });
  // });
});
