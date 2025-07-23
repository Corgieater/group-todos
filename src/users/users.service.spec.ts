import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import * as argon from 'argon2';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '@prisma/client';

describe('UsersService', () => {
  let userService: UsersService;

  let mockPrismaService = {
    user: { create: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    userService = module.get<UsersService>(UsersService);
  });

  it('should hash and create a user', async () => {
    const userData = {
      name: 'test',
      email: 'test@gmail.com',
      password: 'test',
    };
    jest.spyOn(argon, 'hash').mockResolvedValue('hashed');
    const hashedData = {
      name: 'test',
      email: 'test@gmail.com',
      hash: 'hashed',
    };
    await userService.create(userData);
    expect(mockPrismaService.user.create).toHaveBeenCalledWith({
      data: hashedData,
    });
  });
});
