jest.mock('argon2', () => ({
  hash: jest.fn(),
  verify: jest.fn(),
}));

import * as argon from 'argon2';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { ConflictException } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { JwtService } from '@nestjs/jwt';

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: UsersService;

  const mockUsersService = {
    checkIfEmailExists: jest.fn(),
    create: jest.fn(),
    findByEmailOrThrow: jest.fn(),
  };

  const mockJwtService = { signAsync: jest.fn() };

  beforeEach(async () => {
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
      const dto = {
        name: 'test',
        email: 'test@test.com',
        password: 'test',
      };

      (argon.hash as jest.Mock).mockResolvedValueOnce('hashed');

      await authService.signup(dto);

      expect(usersService.checkIfEmailExists).toHaveBeenCalledWith(dto.email);
      expect(argon.hash).toHaveBeenCalledWith(dto.password);
      expect(usersService.create).toHaveBeenCalledWith({
        name: dto.name,
        email: dto.email,
        hash: 'hashed',
      });
    });

    it('should call usersService.checkIfEmailExists and throw conflictException', async () => {
      const dto = {
        name: 'test',
        email: 'test@test.com',
        password: 'test',
      };
      mockUsersService.checkIfEmailExists.mockResolvedValueOnce(true);
      await expect(authService.signup(dto)).rejects.toThrow(ConflictException);

      expect(mockUsersService.checkIfEmailExists).toHaveBeenCalledWith(
        dto.email,
      );
    });
  });

  describe('signin', () => {
    it('should call usersService.findByEmailOrThrow and signToken', async () => {
      const dto = {
        email: 'test@test.com',
        password: 'test',
      };
      const mockUser = {
        id: 1,
        name: 'test',
        hash: 'hashed',
      };
      const payload = {
        sub: mockUser.id,
        userName: mockUser.name,
      };
      mockUsersService.findByEmailOrThrow.mockResolvedValueOnce(mockUser);
      (argon.verify as jest.Mock).mockResolvedValueOnce(true);
      const signTokenSpy = jest
        .spyOn(authService, 'signToken')
        .mockResolvedValueOnce('jwtToken');
      const result = await authService.signin(dto.email, dto.password);
      expect(usersService.findByEmailOrThrow).toHaveBeenCalledWith(dto.email);
      expect(argon.verify).toHaveBeenCalledWith(mockUser.hash, dto.password);
      expect(signTokenSpy).toHaveBeenCalledWith(payload);
      expect(result).toEqual({ access_token: 'jwtToken' });
    });
  });
});
