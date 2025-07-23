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
      findUniqueOrThrow: jest.fn(),
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
  describe('signup', () => {
    it('should add user and hash password', async () => {
      const dto = {
        name: 'test',
        email: 'test@test.com',
        password: 'test',
      };

      (argon.hash as jest.Mock).mockResolvedValueOnce('hashed');

      await authService.signup(dto);

      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: dto.email },
        select: {
          id: true,
          name: true,
          email: true,
        },
      });
      expect(argon.hash).toHaveBeenCalledWith(dto.password);
      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: {
          email: 'test@test.com',
          hash: 'hashed',
          name: 'test',
        },
      });
    });

    it('should throw conflictException', async () => {
      const dto = {
        name: 'test',
        email: 'test@test.com',
        password: 'test',
      };
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 1,
        name: 'test',
        email: dto.email,
      });
      await expect(authService.signup(dto)).rejects.toThrow(ConflictException);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: dto.email },
        select: {
          id: true,
          name: true,
          email: true,
        },
      });
    });
  });

  describe('signin', () => {
    it('should sign user in and issue access token', async () => {
      const mockReq = {};
      const dto = {
        email: 'test@test.com',
        password: 'password',
      };
      const mockUser = {
        id: 1,
        email: 'test@test.com',
        hash: 'hashed',
      };
      await authService.signin(dto);
      expect(prismaService.user.findUniqueOrThrow).toHaveBeenCalledWith(dto);
      expect(argon.verify).toHaveBeenCalledWith(mockUser.hash, dto.password);
    });
  });
});
