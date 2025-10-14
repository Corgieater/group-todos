import { Test, TestingModule } from '@nestjs/testing';
import { GroupsService } from './groups.service';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  ActionTokenType,
  GroupRole,
  type Group as GroupModel,
  type User as UsersModel,
} from '@prisma/client';
import { createMockUser } from 'src/test/factories/mock-user.factory';
import { UsersService } from 'src/users/users.service';
import {
  AuthErrors,
  GroupsErrors,
  MembershipErrors,
  UsersErrors,
} from 'src/errors';
import { MailService } from 'src/mail/mail.service';
import { AuthService } from 'src/auth/auth.service';
import { ConfigService } from '@nestjs/config';
import { createMockConfig } from 'src/test/factories/mock-config.factory';

describe('GroupService', () => {
  let groupsService: GroupsService;

  const mockConfigService = createMockConfig();
  const user: UsersModel = createMockUser();

  const mockUsersService = {
    findByIdOrThrow: jest.fn(),
    findByEmail: jest.fn(),
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
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    actionToken: {
      create: jest.fn(),
      upsert: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn().mockImplementation(async (cb: any) => {
      const tx = {
        group: mockPrismaService.group,
        actionToken: mockPrismaService.actionToken,
        groupMember: mockPrismaService.groupMember,
      };
      return cb(tx);
    }),
  };

  const mockMailService = {
    sendPasswordReset: jest.fn(),
    sendGroupInvite: jest.fn(),
  };

  const mockAuthService = {
    hash: jest.fn(),
    verify: jest.fn(),
    generateUrlFriendlySecret: jest.fn(),
    hmacToken: jest.fn(),
    safeEqualB64url: jest.fn(),
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
        { provide: MailService, useValue: mockMailService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: mockConfigService.mock },
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
      // TODO: this is odd, fix this
      const ownerId = 1;
      const name = 'test group';
      mockUsersService.findByIdOrThrow.mockResolvedValueOnce(user);
      mockPrismaService.group.create.mockResolvedValueOnce({
        id: 1,
        ownerId,
        name,
      });

      await expect(
        groupsService.createGroup(ownerId, name),
      ).resolves.toBeUndefined();

      expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(1);
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.group.create).toHaveBeenCalledWith({
        data: { ownerId, name },
      });
      expect(mockPrismaService.group.create).toHaveBeenCalledTimes(1);

      expect(mockPrismaService.groupMember.create).toHaveBeenCalledWith({
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
      expect(mockPrismaService.group.create).not.toHaveBeenCalled();
      expect(mockPrismaService.groupMember.create).not.toHaveBeenCalled();
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
      ).rejects.toBeInstanceOf(GroupsErrors.GroupNotFoundError);
      expect(mockPrismaService.group.deleteMany).toHaveBeenCalledWith({
        where: { id: 1, ownerId: 2 },
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // leaveGroup
  // ───────────────────────────────────────────────────────────────────────────────
  describe('leaveGroup', () => {
    it('should let members or admins leave groups (count=1)', async () => {
      // 1. get groupMember by groupId and userId, select role
      // 2. if role do the following
      // 3. if role !== owner, delete the row
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.MEMBER,
      });
      mockPrismaService.groupMember.deleteMany.mockResolvedValueOnce({
        count: 1,
      });

      await groupsService.leaveGroup(group.id, 6);

      expect(mockPrismaService.groupMember.findUnique).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId: 1, userId: 6 } },
        select: { role: true },
      });

      expect(mockPrismaService.groupMember.deleteMany).toHaveBeenCalledWith({
        where: { groupId: 1, userId: 6, role: { not: GroupRole.OWNER } },
      });
    });

    it('should throw GroupMemberNotFoundError', async () => {
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce(null);
      await expect(groupsService.leaveGroup(99, 6)).rejects.toBeInstanceOf(
        GroupsErrors.GroupMemberNotFoundError,
      );

      expect(mockPrismaService.groupMember.deleteMany).not.toHaveBeenCalled();
    });

    it('should throw OwnerCanNotLeaveTheGroupError', async () => {
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.OWNER,
      });

      await expect(groupsService.leaveGroup(1, 1)).rejects.toBeInstanceOf(
        GroupsErrors.OwnerCanNotLeaveTheGroupError,
      );

      expect(mockPrismaService.groupMember.deleteMany).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // inviteGroupMember
  // ───────────────────────────────────────────────────────────────────────────────

  describe('inviteGroupMember', () => {
    const actor = {
      role: GroupRole.ADMIN,
      user: { id: 1, name: 'test' },
      group: { name: 'test group' },
    };
    const invitee = { id: 2, name: 'test2', email: 'test2@test.com' };
    const RAW_TOKEN = 'rawUrlFriendlySecret';
    const HASHED_TOKEN = 'hashed';

    beforeEach(() => {
      jest.clearAllMocks();
      mockPrismaService.groupMember.findUnique.mockReset();
      mockUsersService.findByEmail.mockResolvedValue(invitee);
      mockAuthService.generateUrlFriendlySecret.mockReturnValue(RAW_TOKEN);
      mockAuthService.hash.mockResolvedValue(HASHED_TOKEN);
    });

    it('should invite user by Email if group belongs to the inviter (count=1) and invitee is not in the group', async () => {
      // NOTE: in this case, invitee already using my app
      // TODO: wrtie a email case, user not using my app
      mockPrismaService.groupMember.findUnique
        // check if actor exsits in group
        .mockResolvedValueOnce(actor)
        // check if invitee exsits in group
        .mockResolvedValueOnce(null);
      mockAuthService.generateUrlFriendlySecret.mockReturnValueOnce(
        'rawUrlFriendlySecret',
      );
      mockAuthService.hmacToken.mockReturnValueOnce('hashed');
      mockPrismaService.actionToken.upsert.mockResolvedValueOnce({
        id: 5,
      });

      await groupsService.inviteGroupMember(
        group.id,
        actor.user.id,
        invitee.email,
      );

      // 1. check if group pair with ownerId really exists
      expect(mockPrismaService.groupMember.findUnique).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId: 1, userId: 1 } },
        select: {
          role: true,
          user: { select: { id: true, name: true } },
          group: { select: { id: true, name: true } },
        },
      });

      // 2. check if ivitee email inside our db, or we need to switch to another service
      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(
        'test2@test.com',
      );

      // 3. get invitee userId(if exists), and check if they already in the group
      expect(mockPrismaService.groupMember.findUnique).toHaveBeenCalledWith({
        where: {
          groupId_userId: { groupId: 1, userId: 2 },
        },
        select: { userId: true },
      });

      // 4. generate url friendly secret
      expect(mockAuthService.generateUrlFriendlySecret).toHaveBeenCalledWith(
        32,
      );

      // 5. hash secret
      expect(mockAuthService.hmacToken).toHaveBeenCalledWith(
        'rawUrlFriendlySecret',
        expect.any(String),
      );

      const subjectKey = `GROUP_INVITE:group:${group.id}|email:${invitee.email.toLowerCase()}`;

      // 6. save hashed token in db with info that we can use for getting token again
      expect(mockPrismaService.actionToken.upsert).toHaveBeenCalledWith({
        where: { subjectKey },
        update: {
          tokenHash: 'hashed',
          groupId: 1,
          expiresAt: expect.any(Date),
          consumedAt: null,
          revokedAt: null,
        },
        create: {
          type: ActionTokenType.GROUP_INVITE,
          subjectKey,
          tokenHash: 'hashed',
          groupId: 1,
          userId: invitee.id,
          issuedById: 1,
          expiresAt: expect.any(Date),
        },
        select: { id: true },
      });

      // 7. send mail
      expect(mockMailService.sendGroupInvite).toHaveBeenCalledWith(
        'test2@test.com',
        'test2',
        expect.stringContaining(
          `/api/groups/invitation/5/rawUrlFriendlySecret`,
        ),
        'test',
        'test group',
      );
    });

    it('should throw NotAuthorizedToInviteMember if can not find group with member', async () => {
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce(null);

      await expect(
        groupsService.inviteGroupMember(group.id, actor.user.id, invitee.email),
      ).rejects.toBeInstanceOf(GroupsErrors.NotAuthorizedToInviteMember);

      expect(mockPrismaService.groupMember.findUnique).toHaveBeenCalledTimes(1);
      expect(mockUsersService.findByEmail).not.toHaveBeenCalled();
      expect(mockPrismaService.actionToken.upsert).not.toHaveBeenCalled();
      expect(mockMailService.sendGroupInvite).not.toHaveBeenCalled();
    });

    it('should throw NotAuthorizedToInviteMember if actor is a member', async () => {
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        role: GroupRole.MEMBER,
        user: { id: 4, name: 'test4' },
        group: { name: 'test group' },
      });

      await expect(
        groupsService.inviteGroupMember(group.id, 4, invitee.email),
      ).rejects.toBeInstanceOf(GroupsErrors.NotAuthorizedToInviteMember);

      expect(mockPrismaService.groupMember.findUnique).toHaveBeenCalledTimes(1);
      expect(mockUsersService.findByEmail).not.toHaveBeenCalled();
      expect(mockPrismaService.actionToken.upsert).not.toHaveBeenCalled();
      expect(mockMailService.sendGroupInvite).not.toHaveBeenCalled();
    });

    it('should throw UserNotExistError if the email not exists', async () => {
      // TODO: i guess here we can call another service to deal with new user
      // this will be nexy phase
      mockPrismaService.groupMember.findUnique
        .mockResolvedValueOnce(actor)
        .mockResolvedValueOnce(null);
      mockUsersService.findByEmail.mockResolvedValueOnce(null);

      await expect(
        groupsService.inviteGroupMember(group.id, actor.user.id, invitee.email),
      ).rejects.toBeInstanceOf(UsersErrors.UserNotFoundError);

      expect(mockPrismaService.groupMember.findUnique).toHaveBeenCalledTimes(1);
      expect(mockUsersService.findByEmail).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.actionToken.upsert).not.toHaveBeenCalled();
      expect(mockMailService.sendGroupInvite).not.toHaveBeenCalled();
    });

    it('should throw CannotInviteSelfError if members invite themselves', async () => {
      mockPrismaService.groupMember.findUnique.mockResolvedValueOnce({
        userId: 1,
        role: GroupRole.ADMIN,
      });

      mockUsersService.findByEmail.mockResolvedValueOnce({
        id: 1,
        name: 'test',
        email: 'test@test.com',
      });

      await expect(
        groupsService.inviteGroupMember(group.id, 1, 'test@test.com'),
      ).rejects.toBeInstanceOf(MembershipErrors.CannotInviteSelfError);

      expect(mockPrismaService.groupMember.findUnique).toHaveBeenCalledTimes(1);
      expect(mockUsersService.findByEmail).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.actionToken.upsert).not.toHaveBeenCalled();
      expect(mockMailService.sendGroupInvite).not.toHaveBeenCalled();
    });

    // fix this
    it('should throw AlreadyMemberError when invitee has already in group', async () => {
      // NOTE: I think check if member after getting user by email
      mockPrismaService.groupMember.findUnique
        .mockResolvedValueOnce(actor)
        .mockResolvedValueOnce(invitee);
      mockPrismaService.groupMember.findUnique.mockReturnValueOnce({
        userId: invitee.id,
      });

      await expect(
        groupsService.inviteGroupMember(group.id, user.id, invitee.email),
      ).rejects.toBeInstanceOf(MembershipErrors.AlreadyMemberError);

      expect(mockPrismaService.groupMember.findUnique).toHaveBeenCalledTimes(2);
      expect(mockUsersService.findByEmail).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.actionToken.create).not.toHaveBeenCalled();
      expect(mockMailService.sendGroupInvite).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // virifyInvitation
  // ───────────────────────────────────────────────────────────────────────────────

  describe('verifyInvitation', () => {
    const NOW = new Date('2025-01-01T00:00:00Z');
    const STORED_HASH = 'base64urlHash';
    const RAW_TOKEN = 'rawToken';
    const token = {
      id: 3,
      type: ActionTokenType.GROUP_INVITE,
      tokenHash: STORED_HASH,
      subjectKey: 'GROUP_INVITE:group1|email:test2@test.com',
      groupId: group.id,
      userId: 2,
      issuedById: 1,
      expiresAt: new Date('2099-01-01T00:00:00Z'),
      consumedAt: null,
      revokedAt: null,
    };

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(NOW);
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.clearAllMocks();
    });

    it('should pass the email verification and add user to group', async () => {
      mockPrismaService.actionToken.findFirst.mockResolvedValueOnce(token);
      mockAuthService.hmacToken.mockReturnValueOnce(STORED_HASH);
      mockAuthService.safeEqualB64url.mockReturnValueOnce(true);
      mockPrismaService.actionToken.updateMany.mockResolvedValueOnce({
        count: 1,
      });

      await groupsService.verifyInvitation(token.id, RAW_TOKEN);

      expect(mockPrismaService.actionToken.findFirst).toHaveBeenCalledWith({
        where: {
          id: 3,
          type: 'GROUP_INVITE',
          consumedAt: null,
          revokedAt: null,
          expiresAt: { gt: NOW },
          groupId: { not: null },
          userId: { not: null },
        },
        select: {
          id: true,
          type: true,
          tokenHash: true,
          userId: true,
          groupId: true,
        },
      });
      expect(mockAuthService.hmacToken).toHaveBeenCalledWith(
        RAW_TOKEN,
        expect.any(String),
      );
      expect(mockAuthService.safeEqualB64url).toHaveBeenCalledWith(
        STORED_HASH,
        STORED_HASH,
      );

      expect(mockPrismaService.actionToken.updateMany).toHaveBeenCalledWith({
        where: {
          id: 3,
          consumedAt: null,
          revokedAt: null,
          expiresAt: { gt: NOW },
        },
        data: { consumedAt: NOW },
      });

      expect(mockPrismaService.groupMember.upsert).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId: 1, userId: 2 } },
        create: { groupId: 1, userId: 2, role: GroupRole.MEMBER },
        update: {},
      });
    });

    it('should throw invalidTokenError.invite if token not found', async () => {
      mockPrismaService.actionToken.findFirst.mockResolvedValueOnce(null);

      await expect(
        groupsService.verifyInvitation(token.id, RAW_TOKEN),
      ).rejects.toBeInstanceOf(AuthErrors.InvalidTokenError);

      expect(mockAuthService.hmacToken).not.toHaveBeenCalled();
      expect(mockAuthService.safeEqualB64url).not.toHaveBeenCalled();
      expect(mockPrismaService.groupMember.upsert).not.toHaveBeenCalled();
    });

    it('throws InvalidTokenError.verify when HMAC comparison fails', async () => {
      mockPrismaService.actionToken.findFirst.mockResolvedValueOnce(token);
      mockAuthService.hmacToken.mockReturnValueOnce('different');
      mockAuthService.safeEqualB64url.mockReturnValueOnce(false);

      await expect(
        groupsService.verifyInvitation(token.id, RAW_TOKEN),
      ).rejects.toBeInstanceOf(AuthErrors.InvalidTokenError);

      expect(mockPrismaService.actionToken.updateMany).not.toHaveBeenCalled();
      expect(mockPrismaService.groupMember.upsert).not.toHaveBeenCalled();
    });

    it('throws InvalidTokenError.invite when token was already consumed (updateMany count=0)', async () => {
      mockPrismaService.actionToken.findFirst.mockResolvedValueOnce(token);
      mockAuthService.hmacToken.mockReturnValueOnce(STORED_HASH);
      mockAuthService.safeEqualB64url.mockReturnValueOnce(true);
      mockPrismaService.actionToken.updateMany.mockResolvedValueOnce({
        count: 0,
      });

      await expect(
        groupsService.verifyInvitation(token.id, RAW_TOKEN),
      ).rejects.toBeInstanceOf(AuthErrors.InvalidTokenError);

      expect(mockPrismaService.groupMember.upsert).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // updateMemberRole
  // ───────────────────────────────────────────────────────────────────────────────

  describe('updateMemberRole', () => {
    const ownerId = user.id;
    const targetId = 5;

    it('should update role', async () => {
      mockPrismaService.groupMember.findMany.mockResolvedValueOnce([
        {
          groupId: group.id,
          userId: 1,
          role: GroupRole.OWNER,
        },
        {
          groupId: group.id,
          userId: 5,
          role: GroupRole.MEMBER,
        },
      ]);

      await groupsService.updateMemberRole(
        group.id,
        targetId,
        GroupRole.ADMIN,
        ownerId,
      );

      expect(mockPrismaService.groupMember.findMany).toHaveBeenCalledWith({
        where: { groupId: 1, userId: { in: [1, 5] } },
        select: { userId: true, role: true },
      });

      expect(mockPrismaService.groupMember.update).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId: 1, userId: 5 } },
        data: { role: GroupRole.ADMIN },
      });
    });

    it('should throw userNotFoundError', async () => {
      mockPrismaService.groupMember.findMany.mockResolvedValueOnce([
        {
          groupId: group.id,
          userId: 1,
          role: GroupRole.OWNER,
        },
      ]);

      await expect(
        groupsService.updateMemberRole(group.id, 99, GroupRole.ADMIN, ownerId),
      ).rejects.toBeInstanceOf(GroupsErrors.GroupMemberNotFoundError);
      expect(mockPrismaService.groupMember.update).not.toHaveBeenCalled();
    });

    it('should throw RoleUpdateForbiddenError', async () => {
      // if owner not found in this group
      mockPrismaService.groupMember.findMany.mockResolvedValueOnce([
        {
          groupId: group.id,
          userId: 5,
          role: GroupRole.MEMBER,
        },
      ]);

      await expect(
        groupsService.updateMemberRole(group.id, targetId, GroupRole.ADMIN, 99),
      ).rejects.toBeInstanceOf(GroupsErrors.GroupPermissionError);
      expect(mockPrismaService.groupMember.update).not.toHaveBeenCalled();
    });

    it('should throw NotAuthorizedToUpdateMemberRoleError', async () => {
      mockPrismaService.groupMember.findMany.mockResolvedValueOnce([
        {
          groupId: group.id,
          userId: 8,
          role: GroupRole.MEMBER,
        },
        {
          groupId: group.id,
          userId: 5,
          role: GroupRole.MEMBER,
        },
      ]);

      await expect(
        groupsService.updateMemberRole(group.id, targetId, GroupRole.ADMIN, 8),
      ).rejects.toBeInstanceOf(
        GroupsErrors.NotAuthorizedToUpdateMemberRoleError,
      );
      expect(mockPrismaService.groupMember.update).not.toHaveBeenCalled();
    });

    it('should throw OwnerDowngradeFrobidden', async () => {
      mockPrismaService.groupMember.findMany.mockResolvedValueOnce([
        {
          groupId: group.id,
          userId: 1,
          role: GroupRole.OWNER,
        },
      ]);

      await expect(
        groupsService.updateMemberRole(
          group.id,
          ownerId,
          GroupRole.ADMIN,
          ownerId,
        ),
      ).rejects.toBeInstanceOf(GroupsErrors.OwnerDowngradeForbiddenError);
      expect(mockPrismaService.groupMember.update).not.toHaveBeenCalled();
    });

    it('should throw OwnerRoleChangeForbiddenError', async () => {
      mockPrismaService.groupMember.findMany.mockResolvedValueOnce([
        { id: 101, userId: 8, role: GroupRole.OWNER },
        { id: 102, userId: 9, role: GroupRole.OWNER },
      ]);

      await expect(
        groupsService.updateMemberRole(group.id, 9, GroupRole.ADMIN, 8),
      ).rejects.toBeInstanceOf(GroupsErrors.OwnerRoleChangeForbiddenError);
      expect(mockPrismaService.groupMember.update).not.toHaveBeenCalled();
    });

    it('should not hit db update if role is the same', async () => {
      mockPrismaService.groupMember.findMany.mockResolvedValueOnce([
        { id: 1, userId: 12, role: GroupRole.OWNER },
        { id: 1, userId: 21, role: GroupRole.MEMBER },
      ]);

      await expect(
        groupsService.updateMemberRole(group.id, 21, GroupRole.MEMBER, 12),
      ).resolves.toBe(undefined);

      expect(mockPrismaService.groupMember.findMany).toHaveBeenCalledWith({
        where: { groupId: group.id, userId: { in: [12, 21] } },
        select: { userId: true, role: true },
      });
      expect(mockPrismaService.groupMember.update).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // kickOutMember
  // ───────────────────────────────────────────────────────────────────────────────

  describe('kickOutMember', () => {
    const groupId = 1;

    const mockGroupFound = () =>
      mockPrismaService.group.findUnique.mockResolvedValue({ id: groupId });
    const mockGroupNotFound = () =>
      mockPrismaService.group.findUnique.mockResolvedValue(null);

    const mockMembers = (
      actor: { id: number; role: GroupRole },
      target: { id: number; role: GroupRole },
    ) =>
      mockPrismaService.groupMember.findMany.mockResolvedValueOnce([
        { id: groupId, userId: actor.id, role: actor.role },
        { id: groupId, userId: target.id, role: target.role },
      ]);

    const expectQueried = (actorId: number, targetId: number) => {
      expect(mockPrismaService.group.findUnique).toHaveBeenCalledWith({
        where: { id: groupId },
        select: { id: true },
      });
      expect(mockPrismaService.groupMember.findMany).toHaveBeenCalledWith({
        where: { groupId, userId: { in: [actorId, targetId] } },
        select: { userId: true, role: true },
      });
    };

    beforeEach(() => {
      jest.clearAllMocks();
      mockGroupFound();
    });

    const expectDeleted = (uid: number) => {
      expect(mockPrismaService.groupMember.delete).toHaveBeenCalledWith({
        where: { groupId_userId: { groupId, userId: uid } },
      });
      expect(mockPrismaService.groupMember.delete).toHaveBeenCalledTimes(1);
    };

    describe('happy paths', () => {
      test.each([
        {
          case: 'OWNER kicks ADMIN',
          actor: { id: 1, role: GroupRole.OWNER },
          target: { id: 2, role: GroupRole.ADMIN },
        },
        {
          case: 'OWNER kicks MEMBER',
          actor: { id: 1, role: GroupRole.OWNER },
          target: { id: 3, role: GroupRole.MEMBER },
        },
        {
          case: 'ADMIN kicks MEMBER',
          actor: { id: 4, role: GroupRole.ADMIN },
          target: { id: 5, role: GroupRole.MEMBER },
        },
      ])('should removes target when $case', async ({ actor, target }) => {
        // mock 兩個人的角色
        mockMembers(actor, target);

        await groupsService.kickOutMember(groupId, target.id, actor.id);

        // 基本查詢斷言
        expect(mockPrismaService.group.findUnique).toHaveBeenCalledWith({
          where: { id: groupId },
          select: { id: true },
        });
        expect(mockPrismaService.groupMember.findMany).toHaveBeenCalledWith({
          where: { groupId, userId: { in: [actor.id, target.id] } },
          select: { userId: true, role: true },
        });

        expectQueried(actor.id, target.id);
        // 刪除行為斷言
        expectDeleted(target.id);
      });
    });

    it('should throw GroupNotFoundError', async () => {
      mockGroupNotFound();
      const actor = { id: 1, role: GroupRole.OWNER };
      const target = { id: 2, role: GroupRole.ADMIN };

      await expect(
        groupsService.kickOutMember(group.id, target.id, actor.id),
      ).rejects.toBeInstanceOf(GroupsErrors.GroupNotFoundError);

      expect(mockPrismaService.group.findUnique).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.groupMember.findMany).not.toHaveBeenCalled();
      expect(mockPrismaService.groupMember.delete).not.toHaveBeenCalled();
    });

    describe('forbidden paths', () => {
      beforeEach(() => {
        jest.clearAllMocks();
        mockPrismaService.group.findUnique.mockResolvedValue({ id: groupId });
      });
      test.each([
        {
          case: 'member kicks member',
          actor: { id: 4, role: GroupRole.MEMBER },
          target: { id: 3, role: GroupRole.MEMBER },
        },
        {
          case: 'admin kicks admin',
          actor: { id: 4, role: GroupRole.ADMIN },
          target: { id: 3, role: GroupRole.ADMIN },
        },
        {
          case: 'admin kicks owner',
          actor: { id: 4, role: GroupRole.ADMIN },
          target: { id: 1, role: GroupRole.OWNER },
        },
      ])(
        'should throw GroupPermissionError when $case',
        async ({ actor, target }) => {
          mockMembers(actor, target);

          await expect(
            groupsService.kickOutMember(group.id, target.id, actor.id),
          ).rejects.toBeInstanceOf(GroupsErrors.GroupPermissionError);

          expect(mockPrismaService.group.findUnique).toHaveBeenCalledTimes(1);
          expect(mockPrismaService.groupMember.delete).not.toHaveBeenCalled();
        },
      );
    });

    it('should thorw NotAuthorizedToRemoveMemberError', async () => {
      mockPrismaService.groupMember.findMany.mockResolvedValueOnce([
        {
          userId: 6,
          role: GroupRole.MEMBER,
        },
      ]);

      await expect(
        groupsService.kickOutMember(groupId, 6, 99),
      ).rejects.toBeInstanceOf(GroupsErrors.NotAuthorizedToRemoveMemberError);

      expect(mockPrismaService.group.findUnique).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.groupMember.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.groupMember.delete).not.toHaveBeenCalled();
    });

    it('should throw GroupMemberNotFound when target not found', async () => {
      mockPrismaService.groupMember.findMany.mockReturnValueOnce([
        {
          userId: 2,
          role: GroupRole.ADMIN,
        },
      ]);

      await expect(
        groupsService.kickOutMember(groupId, 99, 2),
      ).rejects.toBeInstanceOf(GroupsErrors.GroupMemberNotFoundError);

      expect(mockPrismaService.group.findUnique).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.groupMember.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.groupMember.delete).not.toHaveBeenCalled();
    });

    it('should throw OwnerRemovalForbiddenError', async () => {
      const owner = {
        userId: 6,
        role: GroupRole.OWNER,
      };
      mockPrismaService.groupMember.findMany.mockReturnValueOnce([owner]);

      await expect(
        groupsService.kickOutMember(group.id, owner.userId, owner.userId),
      ).rejects.toBeInstanceOf(GroupsErrors.OwnerRemovalForbiddenError);

      expect(mockPrismaService.group.findUnique).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.groupMember.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.groupMember.delete).not.toHaveBeenCalled();
    });

    it('should throw GroupPermissionError when remove one self', async () => {
      const admin = {
        userId: 3,
        role: GroupRole.ADMIN,
      };
      mockPrismaService.groupMember.findMany.mockReturnValueOnce([admin]);

      await expect(
        groupsService.kickOutMember(groupId, admin.userId, admin.userId),
      ).rejects.toBeInstanceOf(GroupsErrors.GroupPermissionError);

      expect(mockPrismaService.group.findUnique).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.groupMember.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.groupMember.delete).not.toHaveBeenCalled();
    });
  });
});
