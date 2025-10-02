import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UsersService } from 'src/users/users.service';
import {
  $Enums,
  type Group as GroupModel,
  GroupRole,
  Prisma,
} from '@prisma/client';
import { GroupsErrors, MembershipErrors, UsersErrors } from 'src/errors';

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
    private readonly prismaService: PrismaService,
    private readonly usersService: UsersService,
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
    ownerId: number,
    email: string,
  ): Promise<void> {
    const exists = await this.prismaService.group.count({
      where: { id, ownerId },
    });
    if (exists !== 1) {
      throw GroupsErrors.GroupNotFoundError.byId(ownerId, id);
    }

    const invitee = await this.usersService.findByEmail(email);
    if (!invitee) {
      throw UsersErrors.UserNotFoundError.byEmail(email);
    }
    if (ownerId === invitee.id) {
      throw MembershipErrors.CannotInviteSelfError.byOwner(ownerId, id);
    }
    try {
      await this.prismaService.groupMember.create({
        data: {
          groupId: id,
          userId: invitee.id,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw MembershipErrors.AlreadyMemberError.byId(invitee.id, id);
      }
      throw e;
    }
  }

  // NOTE:
  // Come back and refactor if the roles get more complicated or i need to compare roles in other function
  async kickOutMember(id: number, targetId: number, actorId: number) {
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
        console.log('can not remove');
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
