jest.mock('argon2', () => ({
  hash: jest.fn(),
}));

import * as argon from 'argon2';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ConflictException } from '@nestjs/common';

describe('AuthService', () => {
  let authService: AuthService;
  let prismaService: PrismaService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should add user and hash password', async () => {
    const dto = {
      userName: 'test',
      email: 'test@test.com',
      password: 'test',
    };

    (argon.hash as jest.Mock).mockResolvedValueOnce('hashed');

    await authService.signup(dto);

    expect(prismaService.user.findUnique).toHaveBeenCalledWith({
      where: { email: dto.email },
      select: {
        id: true,
        userName: true,
        email: true,
      },
    });
    expect(argon.hash).toHaveBeenCalledWith(dto.password);
    expect(prismaService.user.create).toHaveBeenCalledWith({
      data: {
        email: 'test@test.com',
        hash: 'hashed',
        userName: 'test',
      },
    });
  });
  it('should throw conflictException', async () => {
    const dto = {
      userName: 'test',
      email: 'test@test.com',
      password: 'test',
    };
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: 1,
      userName: 'test',
      email: dto.email,
    });
    await expect(authService.signup(dto)).rejects.toThrow(ConflictException);

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: dto.email },
      select: {
        id: true,
        userName: true,
        email: true,
      },
    });
  });
});
