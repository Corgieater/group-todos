import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { User as UserModel } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserCreatePayload, UserUpdatePayload } from 'src/users/types/users';

@Injectable()
export class UsersService {
  constructor(private prismaService: PrismaService) {}
  async create(payload: UserCreatePayload): Promise<void> {
    const data = {
      name: payload.name,
      email: payload.email,
      hash: payload.hash,
    };
    await this.prismaService.user.create({ data: data });
  }

  // findAll() {
  //   return this.prismaService.user.findMany();
  // }
  async checkIfEmailExists(email: string): Promise<boolean> {
    const user = await this.prismaService.user.findUnique({
      where: { email },
      select: { id: true, email: true, hash: true, name: true },
    });
    if (user) {
      return true;
    }
    return false;
  }

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
  async findByIdOrThrow(id: number): Promise<UserModel> {
    try {
      const user = await this.prismaService.user.findUniqueOrThrow({
        where: { id },
      });
      return user;
    } catch (e) {
      if (
        // NOTE:
        // this is for be more friendly to test
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
    const { id, ...updateField } = payload;
    await this.prismaService.user.update({
      where: {
        id,
      },
      data: updateField,
    });
  }

  // remove(id: number) {
  //   return `This action removes a #${id} user`;
  // }
}
