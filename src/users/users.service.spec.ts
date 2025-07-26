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
import { UserCreatePayload, UserInfo } from 'src/types/users';
import { Prisma } from '@prisma/client';

describe('UsersService', () => {
  let usersService: UsersService;
  let mockSignUpDto: { name: string; email: string; password: string };
  let mockCreateUserPayload: UserCreatePayload;
  let mockSigninDto: { email: string; password: string };
  let mockUser: UserInfo;

  const mockPrismaService = {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };

  beforeEach(async () => {
    mockSignUpDto = createMockSignupDto();
    mockCreateUserPayload = createMockCreatePayload();
    mockSigninDto = createMockSigninDto();
    mockUser = createMockUser();

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
      await usersService.create(mockCreateUserPayload);
      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: mockCreateUserPayload,
      });
    });
  });
  describe('checkIfEmailExists', () => {
    it('should return false if email not exist', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(null);
      const result = await usersService.checkIfEmailExists(mockSignUpDto.email);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: mockSignUpDto.email },
        select: { id: true, email: true, hash: true, name: true },
      });
      expect(result).toEqual(false);
    });

    it('should return true if email already exists', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(mockUser);
      const result = await usersService.checkIfEmailExists(mockSignUpDto.email);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: mockSignUpDto.email },
        select: { id: true, email: true, hash: true, name: true },
      });
      expect(result).toEqual(true);
    });
  });
  describe('findByEmailOrThrow', () => {
    it('should return user object', async () => {
      mockPrismaService.user.findUniqueOrThrow.mockResolvedValueOnce(mockUser);
      const result = await usersService.findByEmailOrThrow(mockSigninDto.email);
      expect(result).toEqual(mockUser);
    });

    it('should throw unauthorizedException when email not found (P2025)', async () => {
      const prismaError = {
        code: 'P2025',
        message: 'No record found',
        name: 'PrismaClientKnownRequestError',
      } as Prisma.PrismaClientKnownRequestError;
      mockPrismaService.user.findUniqueOrThrow.mockRejectedValueOnce(
        prismaError,
      );
      await expect(
        usersService.findByEmailOrThrow(mockSigninDto.email),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
