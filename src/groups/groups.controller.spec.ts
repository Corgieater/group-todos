import { Test, TestingModule } from '@nestjs/testing';
import { Request, Response } from 'express';
import { GroupRole } from 'src/generated/prisma/enums';
import type { User as UserModel } from 'src/generated/prisma/client';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { createMockUser } from 'src/test/factories/mock-user.factory';
import {
  createMockReq,
  createMockRes,
} from 'src/test/factories/mock-http.factory';
import { CurrentUser } from 'src/common/types/current-user';
jest.mock('src/common/helpers/flash-helper', () => ({ setSession: jest.fn() }));
import { setSession } from 'src/common/helpers/flash-helper';
import {
  InviteGroupMemberDto,
  KickOutMemberFromGroupDto,
  UpdateMemberRoleDto,
} from './dto/groups.dto';
import { TasksService } from 'src/tasks/tasks.service';
import { TasksAddPayload } from 'src/tasks/types/tasks';
import { GroupsErrors } from 'src/errors';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SecurityService } from 'src/security/security.service';
import { createMockSecurityService } from 'src/test/factories/mock-security.service';

describe('GroupsController', () => {
  let groupsController: GroupsController;
  let user: UserModel;
  let req: Request;
  let res: Response;
  let currentUser: CurrentUser;

  const mockGroupsService = {
    createGroup: jest.fn(),
    inviteGroupMember: jest.fn(),
    disbandGroupById: jest.fn(),
    verifyInvitation: jest.fn(),
    kickOutMember: jest.fn(),
    updateMemberRole: jest.fn(),
    leaveGroup: jest.fn(),
    checkIfMember: jest.fn(),
  };

  const mockTasksService = {
    createTask: jest.fn(),
  };

  const mockSecurityService = createMockSecurityService();

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
      controllers: [GroupsController],
      providers: [
        { provide: GroupsService, useValue: mockGroupsService },
        { provide: TasksService, useValue: mockTasksService },
        { provide: SecurityService, useValue: mockSecurityService },
      ],
    }).compile();

    groupsController = module.get<GroupsController>(GroupsController);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // create
  // ───────────────────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should create a group', async () => {
      const dto = {
        name: 'test group',
      };
      await groupsController.create(req, currentUser, dto, res);
      expect(mockGroupsService.createGroup).toHaveBeenCalledWith(
        1,
        'test group',
      );
      expect(setSession).toHaveBeenCalledWith(req, 'success', 'Group created');
      expect(res.redirect).toHaveBeenCalledWith('/users-home');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // invite
  // ───────────────────────────────────────────────────────────────────────────────

  describe('invite', () => {
    const dto: InviteGroupMemberDto = { email: 'test2@test.com' };
    it('should invite user', async () => {
      await groupsController.invite(req, 1, currentUser, dto, res);

      expect(mockGroupsService.inviteGroupMember).toHaveBeenCalledWith(
        1,
        1,
        'test2@test.com',
      );
      expect(setSession).toHaveBeenCalledWith(
        req,
        'success',
        'Invitation suceed.',
      );
      expect(res.redirect).toHaveBeenCalledWith(`/groups/1`);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // verifyInvitation
  // ───────────────────────────────────────────────────────────────────────────────

  describe('verifyInvitation', () => {
    it('should verify user invitation', async () => {
      await groupsController.verifyInvitation(req, 1, 'rawToken', res);

      expect(mockGroupsService.verifyInvitation).toHaveBeenCalledWith(
        1,
        'rawToken',
      );
      expect(mockSecurityService.signAccessToken).toHaveBeenCalled();
      expect(setSession).toHaveBeenCalledWith(
        req,
        'success',
        'You have been invited to a group!',
      );
      expect(res.redirect).toHaveBeenCalledWith('/groups/1');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // disband
  // ───────────────────────────────────────────────────────────────────────────────

  describe('disband', () => {
    it('should disband a group', async () => {
      await groupsController.disband(req, 1, currentUser, res);

      expect(mockGroupsService.disbandGroupById).toHaveBeenCalledWith(1, 1);
      expect(setSession).toHaveBeenCalledWith(
        req,
        'success',
        'Group has been disbanded',
      );
      expect(res.redirect).toHaveBeenCalledWith('/users-home');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // leave
  // ───────────────────────────────────────────────────────────────────────────────

  describe('leave', () => {
    it('should let admins/members leave group', async () => {
      await groupsController.leave(req, 1, currentUser, res);

      expect(mockGroupsService.leaveGroup).toHaveBeenCalledWith(1, 1);
      expect(setSession).toHaveBeenCalledWith(
        req,
        'success',
        'You have left the group.',
      );
      expect(res.redirect).toHaveBeenCalledWith('/users-home');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // updateMemberRole
  // ───────────────────────────────────────────────────────────────────────────────

  describe('updateMemberRole', () => {
    it('should update member role', async () => {
      const dto: UpdateMemberRoleDto = {
        memberId: 6,
        newRole: GroupRole.ADMIN,
      };
      await groupsController.updateMemberRole(req, 1, currentUser, dto, res);

      expect(mockGroupsService.updateMemberRole).toHaveBeenCalledWith(
        1,
        6,
        GroupRole.ADMIN,
        1,
      );

      expect(setSession).toHaveBeenCalledWith(
        req,
        'success',
        'Member role have been updated',
      );
      expect(res.redirect).toHaveBeenCalledWith('/groups/1');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // kickOutMember
  // ───────────────────────────────────────────────────────────────────────────────

  describe('kickOutMember', () => {
    const groupId: number = 5;
    const dto: KickOutMemberFromGroupDto = { memberId: 3 };

    it('should remove member from group', async () => {
      await groupsController.kickOutMember(req, groupId, currentUser, dto, res);

      expect(mockGroupsService.kickOutMember).toHaveBeenCalledWith(5, 3, 1);
      expect(setSession).toHaveBeenCalledWith(
        req,
        'success',
        'Member already removed from group.',
      );
      expect(res.redirect).toHaveBeenCalledWith(`/groups/5`);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // createGroupTask
  // ───────────────────────────────────────────────────────────────────────────────

  describe('createGroupTask', () => {
    const groupId = 5;
    const dto = {
      title: 'task',
      allDay: true,
    };
    const payload: TasksAddPayload = {
      title: 'task',
      status: null,
      priority: null,
      description: null,
      dueDate: null,
      allDay: true,
      dueTime: null,
      location: null,
      userId: 1,
    };
    it('should create group task', async () => {
      await groupsController.createGroupTask(
        req,
        groupId,
        currentUser,
        dto,
        res,
      );

      expect(mockGroupsService.checkIfMember).toHaveBeenCalledWith(5, 1);
      expect(mockTasksService.createTask).toHaveBeenCalledWith(payload, 5);
      expect(setSession).toHaveBeenCalledWith(
        req,
        'success',
        'Group task added.',
      );
      return res.redirect('/tasks/home');
    });

    it('should throw GroupNotFoundError', async () => {
      mockGroupsService.checkIfMember.mockRejectedValueOnce(
        GroupsErrors.GroupNotFoundError.byId(1, 5),
      );
      await expect(
        groupsController.createGroupTask(req, groupId, currentUser, dto, res),
      ).rejects.toBeInstanceOf(GroupsErrors.GroupNotFoundError);
    });
  });
});
