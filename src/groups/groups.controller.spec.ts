import { Test, TestingModule } from '@nestjs/testing';
import { Request, Response } from 'express';
import type { User as UserModel } from '@prisma/client';
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
  inviteGroupMemberDto,
  kickOutMemberFromGroupDto,
} from './dto/groups.dto';

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
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GroupsController],
      providers: [{ provide: GroupsService, useValue: mockGroupsService }],
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
    const dto: inviteGroupMemberDto = { email: 'test2@test.com' };
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
      expect(setSession).toHaveBeenCalledWith(
        req,
        'success',
        'You have been invited to a group!',
      );
      expect(res.redirect).toHaveBeenCalledWith('/users-home');
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
  // kickOutMember
  // ───────────────────────────────────────────────────────────────────────────────

  describe('kickOutMember', () => {
    const groupId: number = 5;
    const dto: kickOutMemberFromGroupDto = { memberId: 3 };

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
});
