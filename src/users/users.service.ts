import { ConflictException, Injectable } from '@nestjs/common';
import { AuthSignupDto } from '../auth/dto/auth.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as argon from 'argon2';
import { PrismaService } from 'src/prisma/prisma.service';
import e from 'express';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: AuthSignupDto): Promise<void> {
    // check if the email exist, do test
    const existUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existUser) {
      console.log('email exist');
      throw new ConflictException();
    }
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

  findOne(id: number) {
    return `This action returns a #${id} user`;
  }

  update(id: number, updateUserDto: UpdateUserDto) {
    return `This action updates a #${id} user`;
  }

  remove(id: number) {
    return `This action removes a #${id} user`;
  }
}
