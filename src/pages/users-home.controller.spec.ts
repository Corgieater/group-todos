import { Test, TestingModule } from '@nestjs/testing';
import { UsersHomeController } from './users-home.controller';
import { UsersService } from 'src/users/users.service';
import { GroupsService } from 'src/groups/groups.service';
import {
  createMockReq,
  createMockRes,
} from 'src/test/factories/mock-http.factory';
import { CurrentUser } from 'src/common/types/current-user';
import { createMockCurrentUser } from 'src/test/factories/mock-user.factory';

describe('UsersHomeController', () => {
  let controller: UsersHomeController;

  const mockUsersService = {}; // 這支 controller 沒直接用到，可留空
  const mockGroupsService = {
    getGroupListByUserId: jest.fn(),
  };

  const req = createMockReq();
  const res = createMockRes();

  const currentUser: CurrentUser = createMockCurrentUser();

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersHomeController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
        { provide: GroupsService, useValue: mockGroupsService },
      ],
    }).compile();

    controller = module.get(UsersHomeController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders users/home with mapped groups', async () => {
    const memberships = [
      {
        groupId: 10,
        userId: 1,
        role: 'MEMBER',
        joinedAt: new Date('2025-09-28T00:00:00Z'),
        group: { id: 10, name: 'group A' },
      },
      {
        groupId: 20,
        userId: 1,
        role: 'ADMIN',
        joinedAt: new Date('2025-09-28T00:00:00Z'),
        group: { id: 20, name: 'group B' },
      },
    ];
    mockGroupsService.getGroupListByUserId.mockResolvedValueOnce(memberships);

    await controller.home(req, currentUser, res);

    expect(mockGroupsService.getGroupListByUserId).toHaveBeenCalledWith(1);

    expect(res.render).toHaveBeenCalledTimes(1);
    const [view, model] = (res.render as jest.Mock).mock.calls[0];
    expect(view).toBe('users/home');
    expect(model).toEqual({
      name: 'test',
      groups: [
        { id: 10, name: 'group A' },
        { id: 20, name: 'group B' },
      ],
    });
  });

  it('renders empty groups when no memberships', async () => {
    mockGroupsService.getGroupListByUserId.mockResolvedValueOnce([]);

    await controller.home(req, currentUser, res);

    expect(res.render).toHaveBeenCalledWith(
      'users/home',
      expect.objectContaining({ name: 'test', groups: [] }),
    );
  });
});
