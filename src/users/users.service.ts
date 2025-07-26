import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UpdateUserDto } from './dto/update-user.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserInfo, UserCreatePayload } from 'src/types/users';

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

  async findByEmailOrThrow(email: string): Promise<UserInfo> {
    try {
      const user = await this.prismaService.user.findUniqueOrThrow({
        where: { email },
      });
      return user;
    } catch (e) {
      if (
        // NOTE:
        // this is for more test
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
  async findOne(id: number): Promise<{ id: number; email: string } | null> {
    const user = await this.prismaService.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
      },
    });
    return user;
  }

  // update(id: number, updateUserDto: UpdateUserDto) {
  //   return `This action updates a #${id} user`;
  // }

  // remove(id: number) {
  //   return `This action removes a #${id} user`;
  // }
}
