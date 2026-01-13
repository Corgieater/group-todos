import { Injectable } from '@nestjs/common';
import {
  Prisma,
  PrismaClient,
  User as UserModel,
} from 'src/generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserCreatePayload } from 'src/users/types/users';
import { UsersErrors } from 'src/errors';

type TxLike = Prisma.TransactionClient | PrismaClient;

@Injectable()
export class UsersService {
  constructor(private prismaService: PrismaService) {}
  async create(payload: UserCreatePayload): Promise<void> {
    const data = {
      name: payload.name,
      email: payload.email,
      timeZone: payload.timeZone,
      hash: payload.hash,
    };
    await this.prismaService.user.create({ data });
  }

  async findByEmail(email: string): Promise<UserModel | null> {
    return await this.prismaService.user.findUnique({
      where: { email },
    });
  }

  async findById(id: number): Promise<UserModel | null> {
    return await this.prismaService.user.findUnique({
      where: { id },
    });
  }

  // NOTE:
  // Use `findOrThrow` only when you are certain the data should exist.
  // If it doesn't, that indicates a logical or system error.
  async findByEmailOrThrow(email: string): Promise<UserModel> {
    try {
      const user = await this.prismaService.user.findUniqueOrThrow({
        where: { email },
      });
      return user;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw UsersErrors.UserNotFoundError.byEmail(email);
      }
      throw e;
    }
  }

  async findByIdOrThrow(id: number): Promise<UserModel> {
    try {
      const user = await this.prismaService.user.findUniqueOrThrow({
        where: { id },
      });
      return user;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw UsersErrors.UserNotFoundError.byId(id);
      }
      throw e;
    }
  }

  // TODO: see this and compare to other tx situations 1130
  async updatePasswordHash(userId: number, hash: string, tx?: TxLike) {
    const db = (tx ?? this.prismaService) as unknown as {
      user: Prisma.UserDelegate<any>;
    };
    return db.user.update({
      where: { id: userId },
      data: { hash },
    });
  }
}
