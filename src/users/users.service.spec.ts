import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  createMockCreatePayload,
  createMockSignupDto,
  createMockSigninDto,
  createMockUser,
} from 'src/test/factories/mock-user.factory';
import { UserCreatePayload, UserUpdatePayload } from 'src/users/types/users';
import { Prisma, User } from '@prisma/client';
import { AuthSigninDto, AuthSignupDto } from 'src/auth/dto/auth.dto';

describe('UsersService', () => {
  let usersService: UsersService;
  let signUpDto: AuthSignupDto;
  let signinDto: AuthSigninDto;
  let createUserPayload: UserCreatePayload;
  let user: User;

  const mockPrismaService = {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
  };

  const prismaError = {
    code: 'P2025',
    message: 'No record found',
    name: 'PrismaClientKnownRequestError',
  } as Prisma.PrismaClientKnownRequestError;

  beforeEach(async () => {
    jest.clearAllMocks();
    signUpDto = createMockSignupDto();
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

    it('should throw unauthorizedException when email not found (P2025)', async () => {
      mockPrismaService.user.findUniqueOrThrow.mockRejectedValueOnce(
        prismaError,
      );
      await expect(
        usersService.findByEmailOrThrow(signinDto.email),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // TODO:
  // This update might be removed or check if it only update nunessential data
  describe('update', () => {
    it('should update user data based on UserUpdatePayload', async () => {
      const payload: UserUpdatePayload = {
        id: 1,
        name: 'foo',
        hash: 'newHash',
      };
      await usersService.update(payload);
      expect(mockPrismaService.user.update).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: {
          id: payload.id,
        },
        data: { name: payload.name, hash: payload.hash },
      });
      expect(
        mockPrismaService.user.update.mock.calls[0][0].data,
      ).not.toHaveProperty('id');
    });

    it('should update specific user field', async () => {
      const payload: UserUpdatePayload = {
        id: 1,
        name: 'foo',
      };
      await usersService.update(payload);
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: {
          id: payload.id,
        },
        data: { name: payload.name },
      });
      expect(
        mockPrismaService.user.update.mock.calls[0][0].data,
      ).not.toHaveProperty('id');
    });
  });
});
