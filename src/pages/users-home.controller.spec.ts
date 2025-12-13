import { Test, TestingModule } from '@nestjs/testing';
import { UsersHomeController } from './users-home.controller';
import { UsersService } from 'src/users/users.service';
import {
  createMockReq,
  createMockRes,
} from 'src/test/factories/mock-http.factory';
import { CurrentUser } from 'src/common/types/current-user';
import { createMockCurrentUser } from 'src/test/factories/mock-user.factory';

describe('UsersHomeController', () => {
  let controller: UsersHomeController;

  const req = createMockReq();
  const res = createMockRes();

  const currentUser: CurrentUser = createMockCurrentUser();

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersHomeController],
    }).compile();

    controller = module.get(UsersHomeController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // home
  // ───────────────────────────────────────────────────────────────────────────────

  describe('home', () => {
    it('renders users/home with mapped groups', async () => {
      await controller.home(req, currentUser, res);

      expect(res.render).toHaveBeenCalledTimes(1);
      const [view, model] = (res.render as jest.Mock).mock.calls[0];
      expect(view).toBe('users/home');
      expect(model).toEqual({
        name: 'test',
      });
    });
  });
});
