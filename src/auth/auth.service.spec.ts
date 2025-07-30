jest.mock('argon2', () => ({
  hash: jest.fn(),
  verify: jest.fn(),
}));

import * as argon from 'argon2';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { JwtService } from '@nestjs/jwt';
import { User as UserModel } from '@prisma/client';
import { AuthSigninDto, AuthSignupDto } from './dto/auth.dto';
import {
  createMockSignupDto,
  createMockSigninDto,
  createMockUser,
} from 'src/test/factories/mock-user.factory';
import { AuthUpdatePasswordPayload } from './types/auth';

describe('AuthService', () => {
  let authService: AuthService;

  let mockAuthSignupDto: AuthSignupDto;
  let mockAuthSigninDto: AuthSigninDto;
  let mockUser: UserModel;

  const mockUsersService = {
    checkIfEmailExists: jest.fn(),
    create: jest.fn(),
    findByEmailOrThrow: jest.fn(),
    findByIdOrThrow: jest.fn(),
    update: jest.fn(),
  };

  const mockJwtService = { signAsync: jest.fn() };

  beforeEach(async () => {
    mockAuthSignupDto = createMockSignupDto();
    mockAuthSigninDto = createMockSigninDto();
    mockUser = createMockUser();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('signup', () => {
    it('should create a new user with hashed password if email is available', async () => {
      (argon.hash as jest.Mock).mockResolvedValueOnce('hashed');

      await authService.signup(mockAuthSignupDto);
      expect(mockUsersService.checkIfEmailExists).toHaveBeenCalledWith(
        mockAuthSignupDto.email,
      );
      expect(argon.hash).toHaveBeenCalledWith(mockAuthSignupDto.password);
      expect(mockUsersService.create).toHaveBeenCalledWith({
        name: mockAuthSignupDto.name,
        email: mockAuthSignupDto.email,
        hash: 'hashed',
      });
    });

    it('should throw ConflictException when email is already taken', async () => {
      mockUsersService.checkIfEmailExists.mockResolvedValueOnce(true);
      await expect(authService.signup(mockAuthSignupDto)).rejects.toThrow(
        ConflictException,
      );

      expect(mockUsersService.checkIfEmailExists).toHaveBeenCalledWith(
        mockAuthSignupDto.email,
      );
    });
  });

  describe('signin', () => {
    it('should sign user in and issue token', async () => {
      const payload = {
        sub: mockUser.id,
        email: mockUser.email,
        userName: mockUser.name,
      };
      mockUsersService.findByEmailOrThrow.mockResolvedValueOnce(mockUser);
      (argon.verify as jest.Mock).mockResolvedValueOnce(true);
      const signTokenSpy = jest
        .spyOn(authService, 'signToken')
        .mockResolvedValueOnce('jwtToken');
      const result = await authService.signin(
        mockAuthSigninDto.email,
        mockAuthSigninDto.password,
      );
      expect(mockUsersService.findByEmailOrThrow).toHaveBeenCalledWith(
        mockAuthSigninDto.email,
      );
      expect(argon.verify).toHaveBeenCalledWith(
        mockUser.hash,
        mockAuthSigninDto.password,
      );
      expect(signTokenSpy).toHaveBeenCalledWith(payload);
      expect(result).toEqual({ access_token: 'jwtToken' });
    });

    it('should throw unauthorizedException when password not match', async () => {
      mockUsersService.findByEmailOrThrow.mockResolvedValueOnce(mockUser);
      (argon.verify as jest.Mock).mockResolvedValueOnce(false);
      await expect(
        authService.signin(mockAuthSigninDto.email, mockAuthSigninDto.password),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('changePassword', () => {
    let payload: AuthUpdatePasswordPayload;
    beforeEach(() => {
      payload = {
        userId: mockUser.id,
        email: mockUser.email,
        oldPassword: 'test',
        newPassword: 'foo',
      };
      mockUsersService.findByIdOrThrow.mockResolvedValueOnce(mockUser);
    });

    it('should change password if old password is correct and new one is different', async () => {
      jest
        .spyOn(authService, 'verifyPassword')
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      (argon.hash as jest.Mock).mockResolvedValueOnce('newHash');

      await authService.changePassword(payload);
      expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(
        payload.userId,
      );
      expect(authService.verifyPassword).toHaveBeenNthCalledWith(
        1,
        'hashed',
        'test',
      );
      expect(authService.verifyPassword).toHaveBeenNthCalledWith(
        2,
        'hashed',
        'foo',
      );
      expect(mockUsersService.update).toHaveBeenCalledWith({
        id: payload.userId,
        hash: 'newHash',
      });
    });

    it('should throw ForbiddenException', async () => {
      jest.spyOn(authService, 'verifyPassword').mockResolvedValueOnce(false);
      await expect(authService.changePassword(payload)).rejects.toThrow(
        new ForbiddenException('Old password is incorrect'),
      );
    });

    it('should throw BadRequestException', async () => {
      jest
        .spyOn(authService, 'verifyPassword')
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);
      await expect(authService.changePassword(payload)).rejects.toThrow(
        new BadRequestException('Please use a new password'),
      );
    });
  });
});
