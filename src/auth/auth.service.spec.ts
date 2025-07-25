jest.mock('argon2', () => ({
  hash: jest.fn(),
  verify: jest.fn(),
}));

import * as argon from 'argon2';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { JwtService } from '@nestjs/jwt';
import { UserInfo } from 'src/types/users';
import {
  createMockSignupDto,
  createMockSigninDto,
  createMockUser,
} from 'src/test/factories/mock-user.factory';

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: UsersService;

  let mockSignupDto: { name: string; email: string; password: string };
  let mockSigninDto: { email: string; password: string };
  let mockUser: UserInfo;

  const mockUsersService = {
    checkIfEmailExists: jest.fn(),
    create: jest.fn(),
    findByEmailOrThrow: jest.fn(),
  };

  const mockJwtService = { signAsync: jest.fn() };

  beforeEach(async () => {
    mockSignupDto = createMockSignupDto();
    mockSigninDto = createMockSigninDto();
    mockUser = createMockUser();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    usersService = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
  describe('signup', () => {
    it('should call usersService to check email exists, hash and call usersService to create user', async () => {
      (argon.hash as jest.Mock).mockResolvedValueOnce('hashed');

      await authService.signup(mockSignupDto);

      expect(usersService.checkIfEmailExists).toHaveBeenCalledWith(
        mockSignupDto.email,
      );
      expect(argon.hash).toHaveBeenCalledWith(mockSignupDto.password);
      expect(usersService.create).toHaveBeenCalledWith({
        name: mockSignupDto.name,
        email: mockSignupDto.email,
        hash: 'hashed',
      });
    });

    it('should call usersService.checkIfEmailExists and throw conflictException 409', async () => {
      mockUsersService.checkIfEmailExists.mockResolvedValueOnce(true);
      await expect(authService.signup(mockSignupDto)).rejects.toThrow(
        ConflictException,
      );

      expect(mockUsersService.checkIfEmailExists).toHaveBeenCalledWith(
        mockSignupDto.email,
      );
    });
  });

  describe('signin', () => {
    it('should call usersService.findByEmailOrThrow and signToken', async () => {
      const payload = {
        sub: mockUser.id,
        userName: mockUser.name,
      };
      mockUsersService.findByEmailOrThrow.mockResolvedValueOnce(mockUser);
      (argon.verify as jest.Mock).mockResolvedValueOnce(true);
      const signTokenSpy = jest
        .spyOn(authService, 'signToken')
        .mockResolvedValueOnce('jwtToken');
      const result = await authService.signin(
        mockSigninDto.email,
        mockSigninDto.password,
      );
      expect(usersService.findByEmailOrThrow).toHaveBeenCalledWith(
        mockSigninDto.email,
      );
      expect(argon.verify).toHaveBeenCalledWith(
        mockUser.hash,
        mockSigninDto.password,
      );
      expect(signTokenSpy).toHaveBeenCalledWith(payload);
      expect(result).toEqual({ access_token: 'jwtToken' });
    });
    it('should throw unauthorizedException 401', async () => {
      mockUsersService.findByEmailOrThrow.mockResolvedValueOnce(mockUser);
      (argon.verify as jest.Mock).mockResolvedValueOnce(false);
      await expect(
        authService.signin(mockSigninDto.email, mockSigninDto.password),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
