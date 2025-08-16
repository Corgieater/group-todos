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
import { MailService } from 'src/mail/mail.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { createMockConfig } from 'src/test/factories/mock-config.factory';

describe('AuthService', () => {
  let authService: AuthService;
  let jwtService: JwtService;

  let mockAuthSignupDto: AuthSignupDto;
  let mockAuthSigninDto: AuthSigninDto;
  let mockUser: UserModel;

  let spyHash: jest.SpiedFunction<AuthService['hash']>;
  let spyVerify: jest.SpiedFunction<AuthService['verify']>;

  const mockUsersService = {
    findByEmail: jest.fn(),
    create: jest.fn(),
    findByEmailOrThrow: jest.fn(),
    findByIdOrThrow: jest.fn(),
    update: jest.fn(),
  };

  const mockPrismaService = {
    resetPasswordToken: {
      create: jest.fn(),
    },
  };

  const mockMailService = {
    sendMail: jest.fn(),
  };

  const mockConfigService = createMockConfig();

  const FAKE_HASH = 'hashed';

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthSignupDto = createMockSignupDto();
    mockAuthSigninDto = createMockSigninDto();
    mockUser = createMockUser();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        JwtService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: MailService, useValue: mockMailService },
        { provide: ConfigService, useValue: mockConfigService.mock },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);

    spyHash = jest.spyOn(authService, 'hash').mockResolvedValue(FAKE_HASH);
    spyVerify = jest.spyOn(authService, 'verify');
  });

  describe('signup', () => {
    it('should create a new user with hashed password if email is available', async () => {
      mockUsersService.findByEmail.mockResolvedValueOnce(null);
      await authService.signup(mockAuthSignupDto);

      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(
        mockAuthSignupDto.email,
      );
      expect(spyHash).toHaveBeenCalledWith(mockAuthSignupDto.password);
      expect(mockUsersService.create).toHaveBeenCalledWith({
        name: mockAuthSignupDto.name,
        email: mockAuthSignupDto.email,
        hash: FAKE_HASH,
      });
    });

    it('should throw ConflictException when email is already taken', async () => {
      mockUsersService.findByEmail.mockResolvedValueOnce(mockUser);
      await expect(authService.signup(mockAuthSignupDto)).rejects.toThrow(
        ConflictException,
      );

      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(
        mockAuthSignupDto.email,
      );
    });
  });

  describe('signin', () => {
    it('should sign user in and issue token', async () => {
      mockUsersService.findByEmailOrThrow.mockResolvedValueOnce(mockUser);
      spyVerify.mockResolvedValueOnce(true);
      const signTokenSpy = jest
        .spyOn(jwtService, 'signAsync')
        .mockResolvedValueOnce('jwtToken');
      const result = await authService.signin(
        mockAuthSigninDto.email,
        mockAuthSigninDto.password,
      );

      expect(mockUsersService.findByEmailOrThrow).toHaveBeenCalledWith(
        mockAuthSigninDto.email,
      );
      expect(spyVerify).toHaveBeenCalledWith(
        mockUser.hash,
        mockAuthSigninDto.password,
      );
      expect(signTokenSpy).toHaveBeenCalledWith({
        sub: mockUser.id,
        email: mockUser.email,
        userName: mockUser.name,
      });
      expect(result).toEqual({ accessToken: 'jwtToken' });
    });

    it('should throw unauthorizedException when password not match', async () => {
      mockUsersService.findByEmailOrThrow.mockResolvedValueOnce(mockUser);
      spyVerify.mockResolvedValueOnce(false);

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
      spyVerify.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await authService.changePassword(payload);
      expect(mockUsersService.findByIdOrThrow).toHaveBeenCalledWith(
        payload.userId,
      );
      expect(spyVerify).toHaveBeenNthCalledWith(
        1,
        mockUser.hash,
        payload.oldPassword,
      );
      expect(spyVerify).toHaveBeenNthCalledWith(
        2,
        mockUser.hash,
        payload.newPassword,
      );
      expect(mockUsersService.update).toHaveBeenCalledWith({
        id: payload.userId,
        hash: FAKE_HASH,
      });
    });

    it('should throw ForbiddenException', async () => {
      spyVerify.mockResolvedValueOnce(false);

      await expect(authService.changePassword(payload)).rejects.toThrow(
        new ForbiddenException('Old password is incorrect'),
      );
    });

    it('should throw BadRequestException', async () => {
      spyVerify.mockResolvedValueOnce(true).mockResolvedValueOnce(true);

      await expect(authService.changePassword(payload)).rejects.toThrow(
        new BadRequestException('Please use a new password'),
      );
    });
  });

  describe('resetPassword', () => {
    it('should send email with link if email exists', async () => {
      const RAW_TOKEN = 'rawUrlFriendlySecret';
      jest
        .spyOn(authService, 'generateUrlFriendlySecret')
        .mockReturnValueOnce(RAW_TOKEN);
      mockUsersService.findByEmail.mockResolvedValueOnce(mockUser);
      mockPrismaService.resetPasswordToken.create.mockResolvedValueOnce({
        id: 1,
      });

      await authService.resetPassword(mockUser.email);

      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(mockUser.email);

      expect(spyHash).toHaveBeenCalledWith(RAW_TOKEN, {
        type: argon.argon2id,
      });
      expect(mockPrismaService.resetPasswordToken.create).toHaveBeenCalledWith({
        data: {
          userId: mockUser.id,
          tokenHash: FAKE_HASH,
        },
        select: { id: true },
      });
      const link = `${mockConfigService.mock.get('BASE_URL')}api/auth/reset-password?id=1&token=${RAW_TOKEN}`;

      expect(mockMailService.sendMail).toHaveBeenCalledWith(mockUser, link);
    });

    it('does nothing if email does not exist', async () => {
      mockUsersService.findByEmail.mockResolvedValueOnce(null);
      await authService.resetPassword('foo@test.com');

      expect(
        mockPrismaService.resetPasswordToken.create,
      ).not.toHaveBeenCalled();
      expect(mockMailService.sendMail).not.toHaveBeenCalled();
    });
  });
});
