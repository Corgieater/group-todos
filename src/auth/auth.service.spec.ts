import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from 'src/users/users.service';
import { JwtService } from '@nestjs/jwt';
import type { User as UserModel } from '@prisma/client';
import { AuthSigninDto, AuthSignupDto } from './dto/auth.dto';
import {
  createMockSignupDto,
  createMockSigninDto,
  createMockUser,
} from 'src/test/factories/mock-user.factory';
import {
  NormalAccessTokenPayload,
  AuthUpdatePasswordPayload,
} from './types/auth';
import { MailService } from 'src/mail/mail.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { createMockConfig } from 'src/test/factories/mock-config.factory';
import { AuthErrors, UsersErrors } from 'src/errors';

jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  verify: jest.fn().mockResolvedValue(true),
}));
import * as argon from 'argon2';

const mockArgon = argon as jest.Mocked<typeof argon>;

describe('AuthService', () => {
  let authService: AuthService;

  const mockJwt = { signAsync: jest.fn() };
  let signupDto: AuthSignupDto;
  let signinDto: AuthSigninDto;
  let user: UserModel;
  let accessPayload: NormalAccessTokenPayload;

  const mockUsersService = {
    findByEmail: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    findByEmailOrThrow: jest.fn(),
    findByIdOrThrow: jest.fn(),
    update: jest.fn(),
    updatePasswordHash: jest.fn(),
  };

  const tx = {
    resetPasswordToken: {
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: { update: jest.fn() },
  };

  const mockPrismaService = {
    resetPasswordToken: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    $transaction: jest.fn().mockImplementation(async (fn, options) => {
      return fn(tx);
    }),
  };

  const mockMailService = {
    sendMail: jest.fn(),
  };

  const mockConfigService = createMockConfig();
  const JWT_TOKEN = 'jwtToken';
  const HASH = 'hashed';

  beforeAll(async () => {
    signupDto = createMockSignupDto();
    signinDto = createMockSigninDto();
    user = createMockUser();
    accessPayload = {
      tokenUse: 'access',
      sub: user.id,
      email: user.email,
      userName: user.name,
      timeZone: user.timeZone,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        JwtService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: MailService, useValue: mockMailService },
        { provide: ConfigService, useValue: mockConfigService.mock },
        {
          provide: JwtService,
          useValue: mockJwt,
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockArgon.hash.mockResolvedValue('hashed');
    mockArgon.verify.mockResolvedValue(true);
    mockJwt.signAsync.mockResolvedValue(JWT_TOKEN);
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // signup
  // ───────────────────────────────────────────────────────────────────────────────

  describe('signup', () => {
    it('should create a new user with hashed password if email is available', async () => {
      mockUsersService.findByEmail.mockResolvedValueOnce(null);
      await authService.signup(signupDto);

      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(
        'test@test.com',
      );
      expect(mockArgon.hash).toHaveBeenCalledWith(
        signupDto.password,
        undefined,
      );
      expect(mockUsersService.create).toHaveBeenCalledWith({
        name: 'test',
        email: 'test@test.com',
        hash: 'hashed',
        timeZone: 'Asia/Taipei',
      });
    });

    it('should throw ConflictException when email is already taken', async () => {
      mockUsersService.findByEmail.mockResolvedValueOnce(user);
      await expect(authService.signup(signupDto)).rejects.toBeInstanceOf(
        AuthErrors.CredentialDuplicatedError,
      );

      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(
        signupDto.email,
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // signin
  // ───────────────────────────────────────────────────────────────────────────────

  describe('signin', () => {
    it('should sign user in and issue token', async () => {
      mockUsersService.findByEmail.mockResolvedValueOnce(user);
      const result = await authService.signin(
        signinDto.email,
        signinDto.password,
      );

      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(
        signinDto.email,
      );
      expect(argon.verify).toHaveBeenCalledWith(user.hash, signinDto.password);
      expect(mockJwt.signAsync).toHaveBeenCalledWith(accessPayload);
      expect(result).toEqual({ accessToken: JWT_TOKEN });
    });

    it('should throw UnauthorizedException when password does not match', async () => {
      mockUsersService.findByEmail.mockResolvedValueOnce(user);
      mockArgon.verify.mockResolvedValueOnce(false);

      await expect(
        authService.signin(signinDto.email, signinDto.password),
      ).rejects.toThrow(AuthErrors.InvalidCredentialError.password());
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // changePassword
  // ───────────────────────────────────────────────────────────────────────────────

  describe('changePassword', () => {
    let payload: AuthUpdatePasswordPayload;

    beforeEach(() => {
      payload = {
        userId: user.id,
        email: user.email,
        oldPassword: 'test',
        newPassword: 'foo',
      };
    });

    it('should change password if old password is correct and new one is different', async () => {
      mockUsersService.findById.mockResolvedValueOnce(user);
      mockArgon.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await authService.changePassword(payload);
      expect(mockUsersService.findById).toHaveBeenCalledWith(payload.userId);
      expect(mockArgon.verify).toHaveBeenNthCalledWith(
        1,
        user.hash,
        payload.oldPassword,
      );
      expect(mockArgon.verify).toHaveBeenNthCalledWith(
        2,
        user.hash,
        payload.newPassword,
      );

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(mockUsersService.updatePasswordHash).toHaveBeenCalledWith(
        payload.userId,
        HASH,
        tx,
      );
    });

    it('should throw error when user not found', async () => {
      mockUsersService.findById.mockResolvedValueOnce(null);

      await expect(authService.changePassword(payload)).rejects.toThrow(
        UsersErrors.UserNotFoundError.byId(payload.userId),
      );
    });

    it('should throw error if old password is incorrect', async () => {
      mockUsersService.findById.mockResolvedValueOnce(user);
      mockArgon.verify.mockResolvedValueOnce(false);

      await expect(authService.changePassword(payload)).rejects.toBeInstanceOf(
        AuthErrors.InvalidOldPasswordError,
      );
    });

    it('should throw error if old and new password are the same', async () => {
      mockUsersService.findById.mockResolvedValueOnce(user);
      mockArgon.verify.mockResolvedValueOnce(true).mockResolvedValueOnce(true);

      await expect(authService.changePassword(payload)).rejects.toThrow(
        new AuthErrors.PasswordReuseError(),
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // resetPassword
  // ───────────────────────────────────────────────────────────────────────────────

  describe('resetPassword', () => {
    let tokenId: number;

    beforeEach(() => {
      tokenId = 2;
    });
    it('should send email with link if email exists', async () => {
      const RAW_TOKEN = 'rawUrlFriendlySecret';
      jest
        .spyOn(authService, 'generateUrlFriendlySecret')
        .mockReturnValueOnce(RAW_TOKEN);
      mockUsersService.findByEmail.mockResolvedValueOnce(user);
      mockPrismaService.resetPasswordToken.create.mockResolvedValueOnce({
        id: tokenId,
      });

      await authService.resetPassword(user.email);

      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(user.email);

      expect(argon.hash).toHaveBeenCalledWith(RAW_TOKEN, {
        type: argon.argon2id,
      });
      expect(mockPrismaService.resetPasswordToken.create).toHaveBeenCalledWith({
        data: {
          userId: user.id,
          tokenHash: HASH,
        },
        select: { id: true },
      });

      expect(mockMailService.sendMail).toHaveBeenCalledWith(
        user,
        expect.stringContaining(
          `/api/auth/verify-reset-token/${tokenId}/${RAW_TOKEN}`,
        ),
      );
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

  // ───────────────────────────────────────────────────────────────────────────────
  // verifyResetToken
  // ───────────────────────────────────────────────────────────────────────────────

  describe('verifyResetToken', () => {
    let tokenId: number;
    let resetPasswordToken: string;
    let resetTokenRow: { id: number; tokenHash: string; user: UserModel };

    beforeEach(() => {
      tokenId = 2;
      resetPasswordToken = 'resetPasswordToken';
      resetTokenRow = { id: tokenId, tokenHash: 'hashedToken', user: user };
    });

    it('should return jwt if id and token matched', async () => {
      const payload = {
        tokenUse: 'resetPassword',
        sub: resetTokenRow.user.id,
        userName: resetTokenRow.user.name,
        email: resetTokenRow.user.email,
        tokenId: resetTokenRow.id,
      };
      mockPrismaService.resetPasswordToken.findFirst.mockResolvedValueOnce(
        resetTokenRow,
      );
      mockArgon.verify.mockResolvedValueOnce(true);
      mockArgon.hash.mockResolvedValueOnce(HASH);

      const token = await authService.verifyResetToken(
        tokenId,
        resetPasswordToken,
      );

      expect(
        mockPrismaService.resetPasswordToken.findFirst,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: tokenId,
            usedAt: null,
            expiredAt: expect.objectContaining({ gt: expect.any(Date) }),
          }),
        }),
      );

      expect(
        mockPrismaService.resetPasswordToken.findFirst,
      ).toHaveBeenCalledWith({
        where: {
          id: tokenId,
          usedAt: null,
          expiredAt: expect.objectContaining({ gt: expect.any(Date) }),
        },
        select: {
          id: true,
          tokenHash: true,
          user: { select: { id: true, name: true, email: true } },
        },
      });
      expect(mockArgon.verify).toHaveBeenCalledWith(
        resetTokenRow.tokenHash,
        resetPasswordToken,
      );
      expect(mockJwt.signAsync).toHaveBeenCalledWith(payload);
      expect(token).toEqual({ accessToken: JWT_TOKEN });
    });

    it('should raise InvalidTokenException if token id not found', async () => {
      mockPrismaService.resetPasswordToken.findFirst.mockResolvedValueOnce(
        null,
      );
      await expect(
        authService.verifyResetToken(1, 'fakeToken'),
      ).rejects.toBeInstanceOf(AuthErrors.InvalidTokenError);
    });

    it('should raise InvalidTokenException if token not matched', async () => {
      mockPrismaService.resetPasswordToken.findFirst.mockResolvedValueOnce(
        resetTokenRow,
      );
      mockArgon.verify.mockResolvedValueOnce(false);

      await expect(
        authService.verifyResetToken(1, 'fakeToken'),
      ).rejects.toBeInstanceOf(AuthErrors.InvalidTokenError);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // confirmResetPassword
  // ───────────────────────────────────────────────────────────────────────────────

  describe('confirmResetPassword', () => {
    let newPassword: string;
    let confirmPassword: string;
    let tokenId: number;
    let userId: number;

    beforeEach(() => {
      tx.resetPasswordToken.updateMany.mockReset();
      tx.resetPasswordToken.deleteMany.mockClear();
      mockUsersService.updatePasswordHash.mockReset();

      mockPrismaService.$transaction.mockClear();
      mockPrismaService.$transaction.mockImplementation(async (fn) => fn(tx));
    });

    it('should reset password, mark token as used, delete other unused tokens', async () => {
      newPassword = 'newPassword';
      confirmPassword = 'newPassword';
      tokenId = 2;
      userId = user.id;

      mockUsersService.findById.mockResolvedValueOnce(user);
      mockArgon.verify.mockResolvedValueOnce(false);
      mockArgon.hash.mockResolvedValueOnce(HASH);

      tx.resetPasswordToken.updateMany.mockResolvedValue({ count: 1 });

      await authService.confirmResetPassword(
        tokenId,
        userId,
        newPassword,
        confirmPassword,
      );

      expect(mockUsersService.findById).toHaveBeenCalledWith(userId);
      expect(mockArgon.verify).toHaveBeenCalledWith(user.hash, newPassword);
      expect(mockArgon.hash).toHaveBeenCalledWith(newPassword, undefined);

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);

      // update token have been used
      expect(tx.resetPasswordToken.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.resetPasswordToken.updateMany).toHaveBeenCalledWith({
        where: {
          id: tokenId,
          userId,
          usedAt: null,
          expiredAt: expect.objectContaining({ gt: expect.any(Date) }),
        },
        data: { usedAt: expect.any(Date) },
      });

      expect(mockUsersService.updatePasswordHash).toHaveBeenCalledTimes(1);
      expect(mockUsersService.updatePasswordHash).toHaveBeenCalledWith(
        user.id,
        HASH,
        tx,
      );

      // delete unused token
      expect(tx.resetPasswordToken.deleteMany).toHaveBeenCalledTimes(1);
      expect(tx.resetPasswordToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: user.id, usedAt: null },
      });

      // ensure we don't delete tokens before it used
      const orderUpdate =
        tx.resetPasswordToken.updateMany.mock.invocationCallOrder[0];
      const orderDelete =
        tx.resetPasswordToken.deleteMany.mock.invocationCallOrder[0];
      expect(orderUpdate).toBeLessThan(orderDelete);
    });

    it('should throw error if user not found', async () => {
      mockUsersService.findById.mockResolvedValueOnce(null);
      await expect(
        authService.confirmResetPassword(
          tokenId,
          999,
          newPassword,
          confirmPassword,
        ),
      ).rejects.toThrow(UsersErrors.UserNotFoundError.byId(999));
    });

    it('should throw error if reset password and old password are the same', async () => {
      mockUsersService.findById.mockResolvedValueOnce(user);
      mockArgon.verify.mockResolvedValueOnce(true);

      await expect(
        authService.confirmResetPassword(
          tokenId,
          user.id,
          newPassword,
          confirmPassword,
        ),
      ).rejects.toThrow(AuthErrors.PasswordReuseError);
    });

    it('should throw error if new password and confirm mismatch', async () => {
      mockUsersService.findById.mockResolvedValueOnce(user);
      mockArgon.verify.mockResolvedValueOnce(false);

      await expect(
        authService.confirmResetPassword(tokenId, user.id, newPassword, 'foo'),
      ).rejects.toBeInstanceOf(AuthErrors.PasswordConfirmationMismatchError);
    });

    it('should throw InvalidTokenError if count !== 1', async () => {
      mockUsersService.findById.mockResolvedValueOnce(user);
      mockArgon.verify.mockResolvedValueOnce(false);
      tx.resetPasswordToken.updateMany.mockReturnValueOnce({ count: 0 });
      await expect(
        authService.confirmResetPassword(
          tokenId,
          userId,
          newPassword,
          confirmPassword,
        ),
      ).rejects.toBeInstanceOf(AuthErrors.InvalidTokenError);
    });
  });
});
