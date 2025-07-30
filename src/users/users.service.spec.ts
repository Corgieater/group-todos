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
  let mockSignUpDto: AuthSignupDto;
  let mockSigninDto: AuthSigninDto;
  let mockCreateUserPayload: UserCreatePayload;
  let mockUser: User;

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

  afterEach(() => {
    jest.clearAllMocks();
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
      mockPrismaService.user.findUniqueOrThrow.mockRejectedValueOnce(
        prismaError,
      );
      await expect(
        usersService.findByEmailOrThrow(mockSigninDto.email),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('findByIdOrThrow', () => {
    it('should return user object', async () => {
      mockPrismaService.user.findUniqueOrThrow.mockReturnValueOnce(mockUser);
      const user = await usersService.findByIdOrThrow(1);
      expect(mockPrismaService.user.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: mockUser.id },
      });
      expect(user).toEqual(mockUser);
    });

    it('should throw UnauthorizedException', async () => {
      mockPrismaService.user.findUniqueOrThrow.mockRejectedValueOnce(
        prismaError,
      );
      await expect(usersService.findByIdOrThrow(1)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(mockPrismaService.user.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: mockUser.id },
      });
    });
  });

  describe('update', () => {
    it('should update user data based on UserUpdatePayload', async () => {
      const payload: UserUpdatePayload = {
        id: 1,
        name: 'foo',
        hash: 'newHash',
      };
      await usersService.update(payload);
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
