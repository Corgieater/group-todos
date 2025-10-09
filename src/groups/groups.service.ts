import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UsersService } from 'src/users/users.service';
import {
  $Enums,
  ActionTokenType,
  type Group as GroupModel,
  GroupRole,
  Prisma,
} from '@prisma/client';
import {
  AuthErrors,
  GroupsErrors,
  MembershipErrors,
  UsersErrors,
} from 'src/errors';
import { AuthService } from 'src/auth/auth.service';
import { MailService } from 'src/mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { addTime } from 'src/common/helpers/util';
import { assertInviteRow } from './type/invite';

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

@Injectable()
export class GroupsService {
  constructor(
    private readonly config: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
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

  async disbandGroupById(id: number, ownerId: number): Promise<void> {
    const { count } = await this.prismaService.group.deleteMany({
      where: { id, ownerId },
    });

    if (count !== 1) {
      throw GroupsErrors.GroupNotFoundError.byId(ownerId, id);
    }
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
      throw GroupsErrors.NotAuthorizedToInviteMember.byId(actorId, id);
    }

    const CAN_INVITE = new Set<GroupRole>([
      GroupRole.ADMIN,
      GroupRole.OWNER,
    ] as const);

    if (!CAN_INVITE.has(actor.role)) {
      throw GroupsErrors.NotAuthorizedToInviteMember.byId(actorId, id);
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

    const rawToken = this.authService.generateUrlFriendlySecret(32);
    const expiresAt = addTime(new Date(), 3, 'd');
    const serverSecret = this.config.getOrThrow<string>('TOKEN_HMAC_SECRET');
    const tokenHash = this.authService.hmacToken(rawToken, serverSecret);

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
    const candidate = this.authService.hmacToken(token, serverSecret);

    if (!this.authService.safeEqualB64url(row.tokenHash, candidate)) {
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

  // NOTE:
  // Come back and refactor if the roles get more complicated or i need to compare roles in other function
  async kickOutMember(
    id: number,
    targetId: number,
    actorId: number,
  ): Promise<void> {
    type GroupRole = $Enums.GroupRole;
    const CAN_REMOVE: ReadonlySet<GroupRole> = new Set([
      GroupRole.OWNER,
      GroupRole.ADMIN,
    ]);

    await this.prismaService.$transaction(async (tx) => {
      const group = await tx.group.findUnique({
        where: { id },
        select: { id: true },
      });

      if (!group) {
        throw GroupsErrors.GroupNotFoundError.byId(actorId, id);
      }
      const rows = await tx.groupMember.findMany({
        where: { groupId: id, userId: { in: [actorId, targetId] } },
        select: { userId: true, role: true },
      });

      const actor = rows.find((r) => r.userId === actorId);
      if (!actor) {
        throw GroupsErrors.NotAuthorizedToRemoveMemberError.byId(
          id,
          actorId,
          targetId,
        );
      }

      if (!CAN_REMOVE.has(actor.role)) {
        throw GroupsErrors.NotAuthorizedToRemoveMemberError.byRole(
          id,
          actorId,
          actor.role,
          Array.from(CAN_REMOVE),
        );
      }

      const target = rows.find((r) => r.userId === targetId);

      if (!target) {
        throw GroupsErrors.GroupMemberNotFoundError.byId(targetId, id);
      }

      if (target.role === GroupRole.OWNER) {
        throw GroupsErrors.OwnerCanNotRemoveSelfFromGroup.byId(
          target.userId,
          id,
        );
      }

      await tx.groupMember.delete({
        where: { groupId_userId: { groupId: id, userId: targetId } },
      });
    });
  }
}
