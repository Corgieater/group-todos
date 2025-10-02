import { Test, TestingModule } from '@nestjs/testing';
import { GroupsService } from './groups.service';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  GroupRole,
  Prisma,
  type Group as GroupModel,
  type User as UsersModel,
} from '@prisma/client';
import { createMockUser } from 'src/test/factories/mock-user.factory';
import { UsersService } from 'src/users/users.service';
import { GroupNotFoundError } from 'src/errors/groups/group-not-found.error';
import { GroupsErrors, MembershipErrors, UsersErrors } from 'src/errors';

describe('GroupService', () => {
  let groupsService: GroupsService;

  const user: UsersModel = createMockUser();

  const mockUsersService = {
    findByIdOrThrow: jest.fn(),
    findByEmail: jest.fn(),
  };

  const tx = {
    group: { create: jest.fn(), findUnique: jest.fn() },
    groupMember: { create: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
  };

  const mockPrismaService = {
    group: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    groupMember: {
      create: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
  };

  const group: GroupModel = {
    id: 1,
    name: 'test group',
    ownerId: 1,
    createdAt: new Date('2025-09-01T13:02:00.549Z'),
    updatedAt: new Date('2025-09-01T13:02:00.549Z'),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupsService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    groupsService = module.get<GroupsService>(GroupsService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrismaService.group.findUnique.mockResolvedValue(group);
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // createGroup
  // ───────────────────────────────────────────────────────────────────────────────

  describe('createGroup', () => {
    it('should create group', async () => {
      const ownerId = 1;
      const name = 'test group';
      mockUsersService.findByIdOrThrow.mockResolvedValueOnce(user);
      tx.group.create.mockResolvedValueOnce({ id: 1, ownerId, name });

      await expect(
        groupsService.createGroup(ownerId, name),
      ).resolves.toBeUndefined();

      expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(1);
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.group.create).toHaveBeenCalledWith({ data: { ownerId, name } });
      expect(mockPrismaService.group.create).not.toHaveBeenCalled();

      expect(tx.groupMember.create).toHaveBeenCalledWith({
        data: { groupId: 1, userId: ownerId, role: 'OWNER' },
      });
    });

    it('should not create group if user not found', async () => {
      mockUsersService.findByIdOrThrow.mockRejectedValueOnce(
        UsersErrors.UserNotFoundError.byId(999),
      );
      await expect(
        groupsService.createGroup(999, 'test'),
      ).rejects.toBeInstanceOf(UsersErrors.UserNotFoundError);

      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      expect(tx.group.create).not.toHaveBeenCalled();
      expect(tx.groupMember.create).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // getGroupListByUserId
  // ───────────────────────────────────────────────────────────────────────────────

  describe('getGroupListByUserId', () => {
    it('should return a list of groups', async () => {
      const groups = [
        {
          groupId: 1,
          userId: 1,
          role: 'MEMBER',
          joinedAt: new Date('2025-09-28T07:35:51.289Z'),
          group: { id: 1, name: 'group1' },
        },
        {
          groupId: 2,
          userId: 1,
          role: 'MEMBER',
          joinedAt: new Date('2025-09-28T07:35:51.289Z'),
          group: { id: 2, name: 'group2' },
        },
      ];
      mockUsersService.findByIdOrThrow.mockResolvedValueOnce(user);
      mockPrismaService.groupMember.findMany.mockResolvedValueOnce(groups);
      const groupList = await groupsService.getGroupListByUserId(user.id);

      expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(1);
      expect(mockPrismaService.groupMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 1 },
          include: { group: { select: { id: true, name: true } } },
        }),
      );
      expect(groupList).toEqual(groups);
    });

    it('should return empty array', async () => {
      mockPrismaService.groupMember.findMany.mockResolvedValueOnce([]);
      const groupList = await groupsService.getGroupListByUserId(user.id);

      expect(groupList).toEqual([]);
    });

    it('should not hit database when user not found', async () => {
      mockUsersService.findByIdOrThrow.mockRejectedValueOnce(
        UsersErrors.UserNotFoundError.byId(999),
      );
      await expect(
        groupsService.getGroupListByUserId(999),
      ).rejects.toBeInstanceOf(UsersErrors.UserNotFoundError);

      expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(999);
      expect(mockPrismaService.groupMember.findMany).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // getGroupDetailsByMemberId
  // ───────────────────────────────────────────────────────────────────────────────

  describe('getGroupDetailsByMemberId', () => {
    it('returns group details when requester is owner or member', async () => {
      const dbGroup = {
        id: 1,
        name: 'test group',
        ownerId: 1,
        owner: { id: 1, name: 'owner', email: 'o@test.com' },
        members: [
          {
            groupId: 1,
            userId: 2,
            role: 'MEMBER',
            joinedAt: new Date('2025-09-01T00:00:00Z'),
            user: { id: 2, name: 'alice', email: 'a@test.com' },
          },
        ],
      };
      mockUsersService.findByIdOrThrow.mockResolvedValueOnce(user);
      mockPrismaService.group.findFirst.mockResolvedValueOnce(dbGroup);

      const result = await groupsService.getGroupDetailsByMemberId(
        group.id,
        user.id,
      );

      expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(1);
      expect(mockPrismaService.group.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 1,
            OR: [{ ownerId: 1 }, { members: { some: { userId: 1 } } }],
          },
          include: {
            owner: { select: { id: true, name: true, email: true } },
            members: {
              include: {
                user: { select: { id: true, name: true, email: true } },
              },
            },
          },
        }),
      );

      expect(result).toBe(dbGroup);
    });

    it('should return GroupNotFoundError', async () => {
      mockPrismaService.group.findFirst.mockResolvedValueOnce(null);
      await expect(
        groupsService.getGroupDetailsByMemberId(99, user.id),
      ).rejects.toBeInstanceOf(GroupsErrors.GroupNotFoundError);
    });

    it('should not hit database when user not found', async () => {
      mockUsersService.findByIdOrThrow.mockRejectedValueOnce(
        UsersErrors.UserNotFoundError.byId(999),
      );
      await expect(
        groupsService.getGroupDetailsByMemberId(1, 999),
      ).rejects.toBeInstanceOf(UsersErrors.UserNotFoundError);

      expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(999);
      expect(mockPrismaService.group.findFirst).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // disbandGroupById
  // ───────────────────────────────────────────────────────────────────────────────

  describe('disbandGroupById', () => {
    it('should delete group when owner matches (count=1)', async () => {
      mockPrismaService.group.deleteMany.mockResolvedValueOnce({ count: 1 });
      await expect(
        groupsService.disbandGroupById(group.id, user.id),
      ).resolves.toBeUndefined();
      expect(mockPrismaService.group.deleteMany).toHaveBeenCalledWith({
        where: {
          id: 1,
          ownerId: 1,
        },
      });
    });

    it('should throw GroupNotFoundError when no row deleted (count=0)', async () => {
      mockPrismaService.group.deleteMany.mockResolvedValueOnce({ count: 0 });
      await expect(
        groupsService.disbandGroupById(group.id, 2),
      ).rejects.toBeInstanceOf(GroupNotFoundError);
      expect(mockPrismaService.group.deleteMany).toHaveBeenCalledWith({
        where: { id: 1, ownerId: 2 },
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // inviteGroupMember
  // ───────────────────────────────────────────────────────────────────────────────

  describe('inviteGroupMember', () => {
    const invitee = { id: 2, name: 'test2', email: 'test2@test.com' };
    it('should invite user by Email if group belongs to the inviter (count=1) and invitee is not in the group', async () => {
      mockPrismaService.group.count.mockResolvedValueOnce(1);
      mockUsersService.findByEmail.mockResolvedValueOnce(invitee);

      await groupsService.inviteGroupMember(group.id, user.id, invitee.email);

      expect(mockPrismaService.group.count).toHaveBeenCalledWith({
        where: { id: group.id, ownerId: user.id },
      });
      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(
        'test2@test.com',
      );
      expect(mockPrismaService.groupMember.create).toHaveBeenCalledWith({
        data: {
          groupId: 1,
          userId: 2,
        },
      });
      expect(mockPrismaService.groupMember.create).toHaveBeenCalledTimes(1);
    });

    it('should throw GroupNotFoundError if the inviter is not the owner (count=0)', async () => {
      mockPrismaService.group.count.mockResolvedValueOnce(0);

      await expect(
        groupsService.inviteGroupMember(group.id, user.id, invitee.email),
      ).rejects.toBeInstanceOf(GroupNotFoundError);

      expect(mockPrismaService.groupMember.create).not.toHaveBeenCalled();
    });

    it('should throw UserNotExistError if the email not exists', async () => {
      mockPrismaService.group.count.mockResolvedValueOnce(1);
      mockUsersService.findByEmail.mockResolvedValueOnce(null);

      await expect(
        groupsService.inviteGroupMember(group.id, user.id, invitee.email),
      ).rejects.toBeInstanceOf(UsersErrors.UserNotFoundError);

      expect(mockPrismaService.groupMember.create).not.toHaveBeenCalled();
    });

    it('should throw CannotInviteSelfError if owners invite themselves', async () => {
      mockPrismaService.group.count.mockResolvedValueOnce(1);
      mockUsersService.findByEmail.mockResolvedValueOnce(user);

      await expect(
        groupsService.inviteGroupMember(group.id, user.id, invitee.email),
      ).rejects.toBeInstanceOf(MembershipErrors.CannotInviteSelfError);

      expect(mockPrismaService.groupMember.create).not.toHaveBeenCalled();
    });

    it('should throw AlreadyMemberError when unique constraint (P2002) is hit', async () => {
      mockPrismaService.group.count.mockResolvedValueOnce(1);
      mockUsersService.findByEmail.mockResolvedValueOnce(invitee);
      const e = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['groupId', 'userId'] },
      });
      mockPrismaService.groupMember.create.mockRejectedValueOnce(e);

      await expect(
        groupsService.inviteGroupMember(group.id, user.id, invitee.email),
      ).rejects.toBeInstanceOf(MembershipErrors.AlreadyMemberError);

      expect(mockPrismaService.groupMember.create).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.groupMember.create).toHaveBeenCalledWith({
        data: { groupId: 1, userId: 2 },
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // kickOutMember
  // ───────────────────────────────────────────────────────────────────────────────

  describe('kickOutMember', () => {
    const actor = { id: 1, role: GroupRole.OWNER };
    const target = { id: 2, role: GroupRole.ADMIN };

    beforeEach(() => {
      tx.group.findUnique.mockResolvedValue({ id: group.id });
    });

    it('should removes target when group exists, actor is OWNER/ADMIN, target is member', async () => {
      tx.groupMember.findMany.mockReturnValueOnce([
        {
          id: group.id,
          userId: actor.id,
          role: actor.role,
        },
        {
          id: group.id,
          userId: target.id,
          role: target.role,
        },
      ]);

      await groupsService.kickOutMember(group.id, target.id, actor.id);

      expect(tx.group.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: { id: true },
      });

      expect(tx.groupMember.findMany).toHaveBeenCalledWith({
        where: { groupId: 1, userId: { in: [1, 2] } },
        select: { userId: true, role: true },
      });

      expect(tx.groupMember.delete).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId: 1, userId: 2 } },
      });

      expect(tx.groupMember.delete).toHaveBeenCalledTimes(1);
    });

    it('should throw GroupNotFoundError', async () => {
      tx.group.findUnique.mockResolvedValueOnce(null);

      await expect(
        groupsService.kickOutMember(group.id, target.id, actor.id),
      ).rejects.toBeInstanceOf(GroupsErrors.GroupNotFoundError);

      expect(tx.group.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.groupMember.findMany).not.toHaveBeenCalled();
      expect(tx.groupMember.delete).not.toHaveBeenCalled();
    });

    it('should throw NotAuthorizedToRemoveMemberError', async () => {
      const member1 = { id: 3, role: GroupRole.MEMBER };
      const member2 = { id: 4, role: GroupRole.MEMBER };

      tx.groupMember.findMany.mockReturnValueOnce([
        {
          id: group.id,
          userId: member1.id,
          role: member1.role,
        },
        {
          id: group.id,
          userId: member2.id,
          role: member2.role,
        },
      ]);

      await expect(
        groupsService.kickOutMember(group.id, member1.id, member2.id),
      ).rejects.toBeInstanceOf(GroupsErrors.NotAuthorizedToRemoveMemberError);

      expect(tx.group.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.groupMember.delete).not.toHaveBeenCalled();
    });

    it('should throw GroupMemberNotFound', async () => {
      tx.groupMember.findMany.mockReturnValueOnce([
        {
          id: group.id,
          userId: actor.id,
          role: actor.role,
        },
      ]);

      await expect(
        groupsService.kickOutMember(group.id, 99, actor.id),
      ).rejects.toBeInstanceOf(GroupsErrors.GroupMemberNotFoundError);

      expect(tx.group.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.groupMember.findMany).toHaveBeenCalledTimes(1);
      expect(tx.groupMember.delete).not.toHaveBeenCalled();
    });

    it('should throw OwnerCanNotRemoveSelf error', async () => {
      const owner = {
        id: group.id,
        userId: 6,
        role: GroupRole.OWNER,
      };
      tx.groupMember.findMany.mockReturnValueOnce([owner]);

      await expect(
        groupsService.kickOutMember(group.id, owner.userId, owner.userId),
      ).rejects.toBeInstanceOf(GroupsErrors.OwnerCanNotRemoveSelfFromGroup);

      expect(tx.group.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.groupMember.findMany).toHaveBeenCalledTimes(1);
      expect(tx.groupMember.delete).not.toHaveBeenCalled();
    });
  });
});
