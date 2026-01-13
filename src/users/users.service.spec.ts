import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from 'src/generated/prisma/client';
import type { User as UserModel } from 'src/generated/prisma/client';
import { UsersService } from './users.service';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  createMockCreatePayload,
  createMockSigninDto,
  createMockUser,
} from 'src/test/factories/mock-user.factory';
import { UserCreatePayload } from 'src/users/types/users';
import { AuthSigninDto } from 'src/auth/dto/auth.dto';
import { UsersErrors } from 'src/errors';

describe('UsersService', () => {
  let usersService: UsersService;
  let signinDto: AuthSigninDto;
  let createUserPayload: UserCreatePayload;
  let user: UserModel;

  const mockPrismaService = {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };

  beforeAll(async () => {
    createUserPayload = createMockCreatePayload();
    signinDto = createMockSigninDto();
    user = createMockUser();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    usersService = module.get<UsersService>(UsersService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create user with the correct payload', async () => {
      await usersService.create(createUserPayload);
      expect(mockPrismaService.user.create).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: createUserPayload,
      });
    });
  });

  describe('findByEmail', () => {
    it('should return user object', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(user);
      const result = await usersService.findByEmail(user.email);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: user.email },
      });
      expect(result).toEqual(user);
    });

    it('should return null if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(null);
      const result = await usersService.findByEmail(user.email);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: user.email },
      });
      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('should return user object', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(user);
      const result = await usersService.findById(user.id);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: user.id },
      });
      expect(result).toEqual(user);
    });

    it('should return null if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(null);
      const result = await usersService.findById(999);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: 999 },
      });
      expect(result).toBeNull();
    });
  });

  describe('findByEmailOrThrow', () => {
    it('should return user object', async () => {
      mockPrismaService.user.findUniqueOrThrow.mockResolvedValueOnce(user);
      const result = await usersService.findByEmailOrThrow(signinDto.email);
      expect(mockPrismaService.user.findUniqueOrThrow).toHaveBeenCalledTimes(1);
      expect(result).toEqual(user);
    });

    it('should throw UsersNotFoundError', async () => {
      const e = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['email'] },
      });
      mockPrismaService.user.findUniqueOrThrow.mockRejectedValueOnce(e);
      await expect(
        usersService.findByEmailOrThrow(signinDto.email),
      ).rejects.toBeInstanceOf(UsersErrors.UserNotFoundError);
    });
  });

  describe('findByIdOrThrow', () => {
    it('should return user object', async () => {
      mockPrismaService.user.findUniqueOrThrow.mockResolvedValueOnce(user);
      const result = await usersService.findByIdOrThrow(user.id);
      expect(mockPrismaService.user.findUniqueOrThrow).toHaveBeenCalledTimes(1);
      expect(result).toEqual(user);
    });

    it('should throw UsersNotFoundError', async () => {
      const e = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['id'] },
      });
      mockPrismaService.user.findUniqueOrThrow.mockRejectedValueOnce(e);
      await expect(
        usersService.findByIdOrThrow(user.id),
      ).rejects.toBeInstanceOf(UsersErrors.UserNotFoundError);
    });
  });
});
