import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UsersService } from 'src/users/users.service';
import {
  ActionTokenType,
  GroupRole,
  Prisma,
} from 'src/generated/prisma/client';
import {
  AuthErrors,
  GroupsErrors,
  MembershipErrors,
  UsersErrors,
} from 'src/errors';
import { MailService } from 'src/mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { addTime } from 'src/common/helpers/util';
import { assertInviteRow } from './type/invite';
import { SecurityService } from 'src/security/security.service';

type GroupListItem = Prisma.GroupMemberGetPayload<{
  include: { group: { select: { id: true; name: true } } };
}>;

type GroupDetailsItem = Prisma.GroupGetPayload<{
  include: {
    owner: { select: { id: true; name: true; email: true } };
    members: {
      include: { user: { select: { id: true; name: true; email: true } } };
    };
  };
}>;

const REMOVAL_MATRIX: Record<GroupRole, Readonly<GroupRole[]>> = {
  OWNER: ['ADMIN', 'MEMBER'] as GroupRole[],
  ADMIN: ['MEMBER'] as GroupRole[],
  MEMBER: [] as GroupRole[],
} as const;

@Injectable()
export class GroupsService {
  constructor(
    private readonly config: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly usersService: UsersService,
    private readonly securityService: SecurityService,
    private readonly mailService: MailService,
  ) {}

  // TODO:
  // 1. create group easily
  // 2. develop invite code
  // 3. create group with member inviting
  async createGroup(ownerId: number, name: string): Promise<void> {
    await this.usersService.findByIdOrThrow(ownerId);

    return this.prismaService.$transaction(async (tx) => {
      const group = await tx.group.create({ data: { ownerId, name } });
      await tx.groupMember.create({
        data: { groupId: group.id, userId: ownerId, role: GroupRole.OWNER },
      });
    });
  }

  // TODO: NOTE:
  // Is it possible i need a pagination here?
  async getGroupListByUserId(userId: number): Promise<GroupListItem[]> {
    await this.usersService.findByIdOrThrow(userId);

    return await this.prismaService.groupMember.findMany({
      where: { userId },
      include: { group: { select: { id: true, name: true } } },
    });
  }

  async getGroupDetailsByMemberId(
    id: number,
    userId: number,
  ): Promise<GroupDetailsItem> {
    await this.usersService.findByIdOrThrow(userId);

    const group = await this.prismaService.group.findFirst({
      where: {
        id,
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        members: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });

    if (!group) {
      throw GroupsErrors.GroupNotFoundError.byId(userId, id);
    }
    return group;
  }

  async requireMemberRole(groupId: number, userId: number) {
    const member = await this.prismaService.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      include: {
        group: { select: { name: true } },
      },
    });

    if (!member)
      throw GroupsErrors.GroupMemberNotFoundError.byId(userId, groupId);

    return {
      role: member.role,
      groupName: member.group.name,
    };
  }
  isAdminish(role: GroupRole | null | undefined): boolean {
    return role === 'OWNER' || role === 'ADMIN';
  }

  async disbandGroupById(id: number, ownerId: number): Promise<void> {
    const { count } = await this.prismaService.group.deleteMany({
      where: { id, ownerId },
    });

    if (count !== 1) {
      throw GroupsErrors.GroupNotFoundError.byId(ownerId, id);
    }
  }

  async leaveGroup(id: number, userId: number): Promise<void> {
    await this.prismaService.$transaction(async (tx) => {
      const membership = await tx.groupMember.findUnique({
        where: { groupId_userId: { groupId: id, userId } },
        select: { role: true },
      });

      if (!membership) {
        throw GroupsErrors.GroupMemberNotFoundError.byId(userId, id);
      }

      if (membership.role === GroupRole.OWNER) {
        throw GroupsErrors.GroupOwnerConstraintError.cannotLeave(id, userId);
      }

      await tx.groupMember.deleteMany({
        where: { groupId: id, userId, role: { not: GroupRole.OWNER } },
      });
    });
  }

  async inviteGroupMember(
    id: number,
    actorId: number,
    email: string,
  ): Promise<void> {
    /**
     * Invites a user to join a group by email.
     *
     * Flow:
     * - Verify the actor is a member of the group and has permission (ADMIN/OWNER).
     * - Look up the invitee by email (must already be an app user).
     * - Prevent self-invite and duplicate membership.
     * - Generate a high-entropy URL-safe token, compute an HMAC-SHA-256 hash,
     *   and UPSERT an ActionToken row using a unique `subjectKey`
     *   (`GROUP_INVITE:group:${id}|email:${email.toLowerCase()}`) so there is
     *   at most one active invite per (group, email).
     * - Set a 3-day expiration.
     * - After the DB write, send the invitation email with one-time URL:
     *   `.../api/groups/invitation/:tokenId/:rawToken`.
     *
     * Side effects:
     * - Writes/updates an ActionToken row.
     * - Sends an email to the invitee (out of transaction).
     *
     * Security:
     * - Only the token hash is stored (HMAC-SHA-256 with a server secret).
     *
     * @param id       Group ID
     * @param actorId  Inviter (actor) user ID
     * @param email    Invitee email
     * @returns Promise<void> Resolves after the token is persisted and the email send is attempted.
     *
     * @throws GroupsErrors.NotAuthorizedToInviteMember  If the actor is not in the group or lacks permission.
     * @throws UsersErrors.UserNotFoundError             If the email is not associated with an app user.
     * @throws MembershipErrors.CannotInviteSelfError    If the actor invites themself.
     * @throws MembershipErrors.AlreadyMemberError       If the invitee is already a member.
     * @throws Prisma.PrismaClientKnownRequestError      If the upsert fails.
     * @throws Error                                     If required config (e.g., TOKEN_HMAC_SECRET or BASE_URL) is missing.
     * @throws Mailer errors If sending the email fails. */

    const actor = await this.prismaService.groupMember.findUnique({
      where: { groupId_userId: { groupId: id, userId: actorId } },
      select: {
        role: true,
        user: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
      },
    });

    if (!actor) {
      throw GroupsErrors.GroupNotFoundError.byId(actorId, id);
    }

    // task有個小工具 應該要把它放util拿來這用?
    const CAN_INVITE = new Set<GroupRole>([
      GroupRole.ADMIN,
      GroupRole.OWNER,
    ] as const);

    if (!CAN_INVITE.has(actor.role)) {
      throw GroupsErrors.GroupActionForbiddenError.inviteMember(id, actorId);
    }

    const invitee = await this.usersService.findByEmail(email);
    if (!invitee) {
      // TODO: NOTE:
      // if email not in our db, call another service to deal with
      throw UsersErrors.UserNotFoundError.byEmail(email);
    }

    if (actorId === invitee.id) {
      throw MembershipErrors.CannotInviteSelfError.byOwner(actorId, id);
    }

    const existsInGroup = await this.prismaService.groupMember.findUnique({
      where: { groupId_userId: { groupId: id, userId: invitee.id } },
      select: { userId: true },
    });

    if (existsInGroup) {
      throw MembershipErrors.AlreadyMemberError.byId(invitee.id, id);
    }

    const rawToken = this.securityService.generateUrlFriendlySecret(32);
    const expiresAt = addTime(new Date(), 3, 'd');
    const serverSecret = this.config.getOrThrow<string>('TOKEN_HMAC_SECRET');
    const tokenHash = this.securityService.hmacToken(rawToken, serverSecret);

    const subjectKey = `GROUP_INVITE:group:${id}|email:${email.toLowerCase()}`;

    const { id: tokenId } = await this.prismaService.actionToken.upsert({
      where: { subjectKey },
      update: {
        tokenHash,
        groupId: id,
        expiresAt,
        consumedAt: null,
        revokedAt: null,
      },
      create: {
        type: ActionTokenType.GROUP_INVITE,
        subjectKey,
        tokenHash,
        groupId: id,
        userId: invitee.id,
        issuedById: actor.user.id,
        expiresAt,
      },
      select: { id: true },
    });

    const baseUrl = this.config.getOrThrow<string>('BASE_URL');
    const link = new URL(
      `api/groups/invitation/${tokenId}/${rawToken}`,
      baseUrl,
    ).toString();

    await this.mailService.sendGroupInvite(
      invitee.email,
      invitee.name,
      link,
      actor.user.name,
      actor.group.name,
    );
  }

  async verifyInvitation(id: number, token: string) {
    const now = new Date();
    const row = await this.prismaService.actionToken.findFirst({
      where: {
        id,
        type: ActionTokenType.GROUP_INVITE,
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
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

    if (!row) {
      throw AuthErrors.InvalidTokenError.invite();
    }
    assertInviteRow(row);

    const serverSecret = this.config.getOrThrow<string>('TOKEN_HMAC_SECRET');
    const candidate = this.securityService.hmacToken(token, serverSecret);

    if (!this.securityService.safeEqualB64url(row.tokenHash, candidate)) {
      throw AuthErrors.InvalidTokenError.verify();
    }

    await this.prismaService.$transaction(async (tx) => {
      const { count } = await tx.actionToken.updateMany({
        where: {
          id: row.id,
          consumedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (count !== 1) {
        throw AuthErrors.InvalidTokenError.invite();
      }

      await tx.groupMember.upsert({
        where: { groupId_userId: { groupId: row.groupId, userId: row.userId } },
        create: {
          groupId: row.groupId,
          userId: row.userId,
          role: GroupRole.MEMBER,
        },
        update: {},
      });
    });
  }

  canRemove(actor: GroupRole, target: GroupRole): boolean {
    return REMOVAL_MATRIX[actor].includes(target);
  }

  async updateMemberRole(
    id: number,
    targetId: number,
    newRole: GroupRole,
    actorId: number,
  ) {
    await this.prismaService.$transaction(async (tx) => {
      const rows = await tx.groupMember.findMany({
        where: {
          groupId: id,
          userId: { in: [actorId, targetId] },
        },
        select: { userId: true, role: true },
      });

      const actor = rows.find((r) => r.userId === actorId);
      const target = rows.find((r) => r.userId === targetId);

      // Not a member in group
      if (!actor) {
        throw GroupsErrors.GroupNotFoundError.byId(actorId, id);
      }

      if (actor.role !== GroupRole.OWNER) {
        throw GroupsErrors.GroupActionForbiddenError.updateRole(
          id,
          actorId,
          actor.role,
          targetId,
        );
      }

      if (!target) {
        throw GroupsErrors.GroupMemberNotFoundError.byId(targetId, id);
      }

      // If we need to deal with group transfer, we need to change this logic
      if (actor.userId === target.userId) {
        throw GroupsErrors.GroupOwnerConstraintError.ownerRoleCanNotBeUpdated(
          id,
          targetId,
          actorId,
        );
      }

      if (target.role === GroupRole.OWNER) {
        throw GroupsErrors.GroupOwnerConstraintError.ownerRoleCanNotBeUpdated(
          id,
          targetId,
          actorId,
        );
      }

      if (target.role === newRole) {
        return;
      }

      await tx.groupMember.update({
        where: { groupId_userId: { groupId: id, userId: target.userId } },
        data: { role: newRole },
      });
    });
  }

  async kickOutMember(
    id: number,
    targetId: number,
    actorId: number,
  ): Promise<void> {
    await this.prismaService.$transaction(async (tx) => {
      const group = await tx.group.findUnique({
        where: { id },
        select: { id: true },
      });

      if (!group) {
        throw GroupsErrors.GroupNotFoundError.byId(actorId, id);
      }
      const rows = await tx.groupMember.findMany({
        where: { groupId: group.id, userId: { in: [actorId, targetId] } },
        select: { userId: true, role: true },
      });

      const actor = rows.find((r) => r.userId === actorId);
      if (!actor) {
        // actor not a group member
        throw GroupsErrors.GroupNotFoundError.byId(actorId, id);
      }

      // If actor is only a member, we don't need to check other things anymore
      if (actor.role === GroupRole.MEMBER) {
        throw GroupsErrors.GroupActionForbiddenError.removeMember(
          id,
          actorId,
          actor.role,
          targetId,
        );
      }

      const target = rows.find((r) => r.userId === targetId);

      if (!target) {
        // target not in group
        throw GroupsErrors.GroupMemberNotFoundError.byId(targetId, id);
      }

      if (target.role === 'OWNER') {
        // can not remove owner
        throw GroupsErrors.GroupOwnerConstraintError.cannotBeRemoved(
          id,
          actorId,
        );
      }

      if (actor.userId === target.userId) {
        // can not remove self
        throw GroupsErrors.GroupOwnerConstraintError.ownerCanNotRemoveThemselves(
          id,
          actorId,
        );
      }

      if (actor.role === GroupRole.ADMIN && target.role === GroupRole.ADMIN) {
        throw GroupsErrors.GroupActionForbiddenError.removeMember(
          id,
          actorId,
          actor.role,
          targetId,
          'ADMINISH_TRIES_TO_REMOVE_OTHER_ADMINISH',
        );
      }

      if (!this.canRemove(actor.role, target.role)) {
        throw GroupsErrors.GroupActionForbiddenError.removeMember(
          id,
          actorId,
          actor.role,
          targetId,
        );
      }

      await tx.groupMember.delete({
        where: { groupId_userId: { groupId: id, userId: targetId } },
      });
    });
  }

  async checkIfMember(id: number, userId: number) {
    const member = await this.prismaService.groupMember.findUnique({
      where: { groupId_userId: { groupId: id, userId } },
      select: { userId: true },
    });

    if (!member) {
      throw GroupsErrors.GroupNotFoundError.byId(userId, id);
    }
  }

  async getMember(
    groupId: number,
    userId: number,
  ): Promise<{ role: GroupRole; group: { id: number; name: string } } | null> {
    return this.prismaService.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { role: true, group: { select: { id: true, name: true } } },
    });
  }

  async listMembersBasic(id: number) {
    const members = await this.prismaService.groupMember.findMany({
      where: { groupId: id },
      select: {
        role: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });

    return members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
    }));
  }
}
