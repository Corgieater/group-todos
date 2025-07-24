import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthSignupDto } from '../auth/dto/auth.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as argon from 'argon2';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserInfo } from 'src/types/users';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}
  // todo: write tests
  async create(dto: AuthSignupDto): Promise<void> {
    const hash = await argon.hash(dto.password);
    const data = {
      name: dto.name,
      email: dto.email,
      hash,
    };
    if (dto.group) {
      data['group'] = dto.group;
    }
    await this.prisma.user.create({ data: data });
  }

  findAll() {
    return this.prisma.user.findMany();
  }
  async checkIfEmailExists(email: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
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
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { email },
      });
      return user;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2025'
      ) {
        throw new UnauthorizedException();
      }
      throw e;
    }
  }
  async findOne(id: number): Promise<{ id: number; email: string } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
      },
    });
    return user;
  }

  update(id: number, updateUserDto: UpdateUserDto) {
    return `This action updates a #${id} user`;
  }

  remove(id: number) {
    return `This action removes a #${id} user`;
  }
}
