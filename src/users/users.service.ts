import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { User as UserModel } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserCreatePayload, UserUpdatePayload } from 'src/users/types/users';

type tx = Prisma.TransactionClient;

@Injectable()
export class UsersService {
  constructor(private prismaService: PrismaService) {}
  async create(payload: UserCreatePayload): Promise<void> {
    const data = {
      name: payload.name,
      email: payload.email,
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
        // NOTE:
        // this is for be more friendly to test
        // TODO:
        // I wonder if this should change to domain error
        e instanceof Prisma.PrismaClientKnownRequestError ||
        e?.name === 'PrismaClientKnownRequestError'
      ) {
        if (e.code === 'P2025') {
          throw new UnauthorizedException();
        }
      }
      throw e;
    }
  }

  async update(payload: UserUpdatePayload): Promise<void> {
    // NOTE/TODO
    // this update will be dangerous if it can called by user
    // maybe should remove this:( or make this a unimportant stuff updating
    const { id, ...updateField } = payload;
    await this.prismaService.user.update({
      where: {
        id,
      },
      data: updateField,
    });
  }

  async updatePasswordHash(userId: number, hash: string, tx?: tx) {
    const db = tx ?? this.prismaService;
    return db.user.update({
      where: { id: userId },
      data: { hash },
    });
  }

  // remove(id: number) {
  //   return `This action removes a #${id} user`;
  // }
}
