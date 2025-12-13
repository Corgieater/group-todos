import { Test, TestingModule } from '@nestjs/testing';
import type {
  User as UserModel,
  Group as GroupModel,
} from 'src/generated/prisma/client';
import { GroupsPageController } from './groups.page.controller';
import { GroupsService } from './groups.service';
import { Request, Response } from 'express';
import { CurrentUser } from 'src/common/types/current-user';
import { createMockUser } from 'src/test/factories/mock-user.factory';
import {
  createMockReq,
  createMockRes,
} from 'src/test/factories/mock-http.factory';
jest.mock('src/common/helpers/flash-helper', () => ({ setSession: jest.fn() }));
import { setSession } from 'src/common/helpers/flash-helper';
jest.mock('src/common/helpers/util', () => ({
  ...jest.requireActual('src/common/helpers/util'),
  buildGroupVM: jest.fn((t: any, tz: string) => ({
    ...t,
    mockVm: true,
    mockTz: tz,
  })),
}));
import { buildGroupVM } from 'src/common/helpers/util';
import { TasksService } from 'src/tasks/tasks.service';

describe('GroupsPageController', () => {
  let groupsPageController: GroupsPageController;
  const mockGroupsService = { getGroupDetailsByMemberId: jest.fn() };
  const mockTasksService = {
    listGroupOpenTasksDueTodayNoneOrExpired: jest.fn(),
  };

  // i think this should include member
  const group: GroupModel = {
    id: 1,
    name: 'test group',
    ownerId: 1,
    createdAt: new Date('2025-09-01T13:02:00.549Z'),
    updatedAt: new Date('2025-09-01T13:02:00.549Z'),
  };

  let user: UserModel;
  let req: Request;
  let res: Response;
  let currentUser: CurrentUser;

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
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GroupsPageController],
      providers: [
        { provide: GroupsService, useValue: mockGroupsService },
        { provide: TasksService, useValue: mockTasksService },
      ],
    }).compile();

    groupsPageController =
      module.get<GroupsPageController>(GroupsPageController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGroupsService.getGroupDetailsByMemberId.mockResolvedValue(group);
  });

  describe('details', () => {
    it('should render group details by member id', async () => {
      const rawGroup = {
        id: 1,
        name: 'test group',
        ownerId: 1,
        createdAt: new Date('2025-09-01T13:02:00.549Z'),
        updatedAt: new Date('2025-09-01T13:02:00.549Z'),
        owner: { id: 1, name: 'owner', email: 'o@test.com' },
        members: [
          {
            groupId: 1,
            userId: 2,
            role: 'MEMBER',
            joinedAt: new Date('2025-09-02T10:00:00.000Z'),
            user: { id: 2, name: 'alice', email: 'a@test.com' },
          },
        ],
      };

      mockGroupsService.getGroupDetailsByMemberId.mockResolvedValueOnce(
        rawGroup,
      );

      const vm = {
        id: 1,
        name: 'test group',
        ownerId: 1,
        createdAtLabel: '2025-09-01 21:02',
        updatedAtLabel: '2025-09-01 21:02',
        owner: rawGroup.owner,
        members: rawGroup.members,
      };
      (buildGroupVM as jest.Mock).mockReturnValueOnce(vm);

      await groupsPageController.detail(req, currentUser, 1, res);

      expect(mockGroupsService.getGroupDetailsByMemberId).toHaveBeenCalledWith(
        1,
        1,
      );
      expect(buildGroupVM).toHaveBeenCalledWith(rawGroup, 'Asia/Taipei');

      const [view, model] = (res.render as jest.Mock).mock.calls[0];
      expect(view).toBe('groups/details');

      expect(model).toEqual({
        canManageMembers: true,
        currentUserId: 1,
        group: {
          id: vm.id,
          name: vm.name,
          createdAtLabel: vm.createdAtLabel,
          updatedAtLabel: vm.updatedAtLabel,
        },
        owner: vm.owner,
        members: vm.members,
        isOwner: true,
        isAdmin: false,
      });
    });

    it('should set isOwner=false when viewer is not owner', async () => {
      const raw = {
        id: 2,
        name: 'g',
        ownerId: 99,
        owner: {},
        members: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockGroupsService.getGroupDetailsByMemberId.mockResolvedValueOnce(raw);
      (buildGroupVM as jest.Mock).mockReturnValueOnce({
        id: 2,
        name: 'g',
        ownerId: 99,
        createdAtLabel: 'x',
        updatedAtLabel: 'y',
        owner: {},
        members: [],
      });

      await groupsPageController.detail(
        req,
        { ...currentUser, userId: 1 },
        2,
        res,
      );

      const [, model] = (res.render as jest.Mock).mock.calls.at(-1)!;
      expect(model.isOwner).toBe(false);
    });
  });
});
