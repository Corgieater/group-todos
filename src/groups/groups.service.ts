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
import { SecurityService } from 'src/security/security.service';
import { PageDto } from 'src/common/dto/page.dto';
import { PageMetaDto } from 'src/common/dto/page-meta.dto';
import { UserAccessInfo } from 'src/auth/types/auth';

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

  async createGroup(ownerId: number, name: string): Promise<void> {
    /**
     * @todo
     * Consider to develop invite code token
     */
    await this.usersService.findByIdOrThrow(ownerId);

    return this.prismaService.$transaction(async (tx) => {
      const group = await tx.group.create({ data: { ownerId, name } });
      await tx.groupMember.create({
        data: { groupId: group.id, userId: ownerId, role: GroupRole.OWNER },
      });
    });
  }

  async updateGroup(actorId: number, id: number, name: string): Promise<void> {
    /**
     * Currently update name only
     */
    const result = await this.prismaService.group.updateMany({
      where: {
        id,
      },
      data: { name },
    });

    if (result.count === 0) {
      throw GroupsErrors.GroupActionForbiddenError.updateGroup(id, actorId);
    }
  }

  async getGroupListByUserId(
    userId: number,
    options: { page?: number; limit?: number; order?: 'ASC' | 'DESC' },
  ): Promise<PageDto<any>> {
    /**
     * @todo
     * Maybe we can let user choose to order by group created time or name in order
     */
    await this.usersService.findByIdOrThrow(userId);

    const { page = 1, limit = 10, order = 'ASC' } = options;
    const skip = (page - 1) * limit;

    const [groups, totalResult] = await Promise.all([
      this.prismaService.groupMember.findMany({
        where: { userId },
        include: {
          group: {
            select: { id: true, name: true, ownerId: true, createdAt: true },
          },
        },
        skip,
        take: limit,
        orderBy: {
          group: {
            createdAt: order.toLowerCase() as any,
          },
        },
      }),
      this.prismaService.groupMember.count({ where: { userId } }),
    ]);
    const itemCount = Number(totalResult ?? 0);
    const pageOptionsDto = { page, limit, skip };
    const meta = new PageMetaDto(pageOptionsDto as any, itemCount);
    return new PageDto(groups, meta);
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

  async getGroupMemberContext(groupId: number, userId: number) {
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
    /**
     * @todo
     * This method is duplicated with tasks.isAdminish,
     * we should consider to build another module for permission checks
     */
    return role === 'OWNER' || role === 'ADMIN';
  }

  async disbandGroupById(id: number, ownerId: number): Promise<void> {
    const { count } = await this.prismaService.group.deleteMany({
      where: { id },
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
  ): Promise<boolean> {
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
     * @returns Promise<boolean> True if email sent successfully, false otherwise (e.g., mail server config issue).
     *
     * @throws GroupsErrors.NotAuthorizedToInviteMember  If the actor is not in the group or lacks permission.
     * @throws UsersErrors.UserNotFoundError             If the email is not associated with an app user.
     * @throws MembershipErrors.CannotInviteSelfError    If the actor invites themself.
     * @throws MembershipErrors.AlreadyMemberError       If the invitee is already a member.
     * @throws Prisma.PrismaClientKnownRequestError      If the upsert fails.
     * @throws Error                                     If required config (e.g., TOKEN_HMAC_SECRET or BASE_URL) is missing.
     * @throws Mailer errors If sending the email fails.
     *
     * @todo Consider develop inviting users with no account (apply account + join group)
     * */

    const actor = await this.prismaService.groupMember.findUnique({
      where: { groupId_userId: { groupId: id, userId: actorId } },
      select: {
        user: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
      },
    });

    if (!actor) {
      throw GroupsErrors.GroupNotFoundError.byId(actorId, id);
    }

    const invitee = await this.usersService.findByEmail(email);
    if (!invitee) {
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

    const mailSent = this.mailService.sendGroupInvite(
      invitee.email,
      invitee.name,
      link,
      actor.user.name,
      actor.group.name,
    );
    return mailSent;
  }

  async verifyInvitation(id: number, token: string): Promise<UserAccessInfo> {
    /**
     * Verifies a group invitation token and joins the user to the group.
     *
     * Flow:
     * - Look up the ActionToken by ID and verify its type (GROUP_INVITE).
     * - Validate the token's state (not consumed, not revoked, and not expired).
     * - Ensure the token is properly linked to both a user and a group.
     * - Re-compute the HMAC-SHA-256 hash using the provided raw token and server secret.
     * - Perform a constant-time comparison to verify the token hash.
     * - Execute a DB transaction:
     * 1. Atomically mark the token as consumed (using updateMany for concurrency control).
     * 2. Idempotently add the user to the group using UPSERT (prevents unique constraint errors).
     * - Generate the necessary user metadata for session creation.
     *
     * Side effects:
     * - Updates an ActionToken row to mark it as consumed.
     * - Creates or updates a GroupMember row in the database.
     *
     * Security:
     * - Constant-time comparison (safeEqualB64url) to mitigate timing attacks.
     * - Atomic consumption logic ensures one-time usage even under high concurrency.
     * - Does not expose internal token hashes in return values.
     *
     * @param id        ActionToken ID from the URL.
     * @param token     The raw high-entropy token from the URL.
     * @returns Promise<UserAccessInfo> User metadata (sub, name, email, timeZone) for JWT signing.
     *
     * @throws AuthErrors.InvalidTokenError.invite  If the token is missing, invalid, expired, or already used.
     * @throws AuthErrors.InvalidTokenError.verify  If the HMAC verification fails (token mismatch).
     * @throws AuthErrors.InternalServerError       If the transaction fails or expected data is missing.
     * @throws Error                                If required config (e.g., TOKEN_HMAC_SECRET) is missing.
     * */
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
      include: {
        user: { select: { id: true, name: true, email: true, timeZone: true } },
      },
    });

    if (!row || !row.user || !row.userId || !row.groupId) {
      throw AuthErrors.InvalidTokenError.invite();
    }

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
        where: {
          groupId_userId: { groupId: row.groupId!, userId: row.userId! },
        },
        create: {
          groupId: row.groupId!,
          userId: row.userId!,
          role: GroupRole.MEMBER,
        },
        update: {},
      });
    });

    return {
      sub: row.userId,
      userName: row.user.name,
      email: row.user.email,
      timeZone: row.user.timeZone,
    };
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

      if (!target) {
        throw GroupsErrors.GroupMemberNotFoundError.byId(targetId, id);
      }

      // If we need to deal with group transfer, we need to change this logic
      if (actor!.userId === target.userId) {
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
