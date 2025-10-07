jest.mock('argon2', () => ({
  __esModule: true,
  hash: jest.fn(),
  verify: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import * as argon from 'argon2';
import { AuthService } from './auth.service';
import { UsersService } from 'src/users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ActionTokenType, type User as UserModel } from '@prisma/client';
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

describe('AuthService', () => {
  let authService: AuthService;

  const mockJwt = { signAsync: jest.fn() };
  const mockArgon = jest.mocked(argon);
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
    actionToken: {
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: { update: jest.fn() },
  };

  const mockPrismaService = {
    actionToken: {
      create: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn().mockImplementation(async (fn, options) => {
      return fn(tx);
    }),
  };

  const mockMailService = {
    sendPasswordReset: jest.fn(),
  };

  const mockConfigService = createMockConfig();
  const JWT_TOKEN = 'jwtToken';
  const HASH = 'hashed';

  beforeAll(async () => {
    // QUESTION:
    // Do I really need these createMock? it seems they only use here
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
    mockJwt.signAsync.mockResolvedValue(JWT_TOKEN);
    mockArgon.hash.mockResolvedValue('hashed');
    mockArgon.verify.mockResolvedValue(true);
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
      expect(mockArgon.hash).not.toHaveBeenCalled();
      expect(mockUsersService.create).not.toHaveBeenCalled();
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
        'test@test.com',
      );
      expect(mockArgon.verify).toHaveBeenCalledWith('hashed', 'test');
      expect(mockJwt.signAsync).toHaveBeenCalledWith(accessPayload);
      expect(result).toEqual({ accessToken: JWT_TOKEN });
    });

    it('should throw UnauthorizedException when password does not match', async () => {
      mockUsersService.findByEmail.mockResolvedValueOnce(user);
      mockArgon.verify.mockResolvedValueOnce(false);

      await expect(
        authService.signin(signinDto.email, signinDto.password),
      ).rejects.toBeInstanceOf(AuthErrors.InvalidCredentialError);

      expect(mockJwt.signAsync).not.toHaveBeenCalled();
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
      // here
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

      await expect(authService.changePassword(payload)).rejects.toBeInstanceOf(
        UsersErrors.UserNotFoundError,
      );

      expect(mockArgon.hash).not.toHaveBeenCalled();
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should throw error if old password is incorrect', async () => {
      mockUsersService.findById.mockResolvedValueOnce(user);
      mockArgon.verify.mockResolvedValueOnce(false);

      await expect(authService.changePassword(payload)).rejects.toBeInstanceOf(
        AuthErrors.InvalidOldPasswordError,
      );

      expect(mockArgon.hash).not.toHaveBeenCalled();
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should throw error if old and new password are the same', async () => {
      mockUsersService.findById.mockResolvedValueOnce(user);

      await expect(authService.changePassword(payload)).rejects.toBeInstanceOf(
        AuthErrors.PasswordReuseError,
      );

      expect(mockArgon.hash).not.toHaveBeenCalled();
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
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
      jest.spyOn(authService, 'hmacToken').mockReturnValueOnce(HASH);
      mockUsersService.findByEmail.mockResolvedValueOnce(user);
      mockPrismaService.actionToken.upsert.mockResolvedValueOnce({
        id: tokenId,
      });

      await authService.resetPassword(user.email);

      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(
        'test@test.com',
      );

      expect(authService.generateUrlFriendlySecret).toHaveBeenCalledWith(32);
      expect(authService.hmacToken).toHaveBeenCalledWith(
        'rawUrlFriendlySecret',
        expect.any(String),
      );

      const subjectKey = `RESET_PASSWORD:user:${user.id}`;
      expect(mockPrismaService.actionToken.upsert).toHaveBeenCalledWith({
        where: { subjectKey },
        update: {
          tokenHash: HASH,
          expiresAt: expect.any(Date),
          consumedAt: null,
          revokedAt: null,
        },
        create: {
          type: ActionTokenType.RESET_PASSWORD,
          subjectKey,
          tokenHash: HASH,
          userId: user.id,
          issuedById: user.id,
          expiresAt: expect.any(Date),
        },
        select: { id: true },
      });

      expect(mockMailService.sendPasswordReset).toHaveBeenCalledWith(
        user,
        expect.stringContaining(
          '/api/auth/verify-reset-token/2/rawUrlFriendlySecret',
        ),
      );
    });

    it('does nothing if email does not exist', async () => {
      mockUsersService.findByEmail.mockResolvedValueOnce(null);
      await authService.resetPassword('foo@test.com');

      expect(mockPrismaService.actionToken.create).not.toHaveBeenCalled();
      expect(mockMailService.sendPasswordReset).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // verifyResetToken
  // ───────────────────────────────────────────────────────────────────────────────

  describe('verifyResetToken', () => {
    let tokenId: number;
    let rawToken: string;

    beforeEach(() => {
      tokenId = 2;
      rawToken = 'resetPasswordToken';
    });

    // read the following test
    it('should return jwt if id and token matched', async () => {
      const STORED_HASH = 'base64urlHash';
      mockPrismaService.actionToken.findFirst.mockResolvedValueOnce({
        id: tokenId,
        tokenHash: STORED_HASH,
        user: { id: user.id, name: user.name, email: user.email },
      });

      const hmacSpy = jest
        .spyOn(authService, 'hmacToken')
        .mockReturnValueOnce(STORED_HASH);

      // spy：safeEqual 回 true（同步 boolean，不是 Promise）
      const eqSpy = jest
        .spyOn(authService, 'safeEqualB64url')
        .mockReturnValueOnce(true);

      const result = await authService.verifyResetToken(tokenId, rawToken);

      expect(mockPrismaService.actionToken.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: tokenId,
            type: 'RESET_PASSWORD',
            userId: { not: null },
            consumedAt: null,
            expiresAt: expect.objectContaining({ gt: expect.any(Date) }),
          }),
          select: {
            id: true,
            tokenHash: true,
            user: { select: { id: true, name: true, email: true } },
          },
        }),
      );

      expect(hmacSpy).toHaveBeenCalledWith(rawToken, expect.any(String));
      expect(eqSpy).toHaveBeenCalledWith(STORED_HASH, STORED_HASH);

      expect(mockJwt.signAsync).toHaveBeenCalledWith({
        tokenUse: 'resetPassword',
        sub: user.id,
        userName: user.name,
        email: user.email,
        tokenId,
      });
      expect(result).toEqual({ accessToken: JWT_TOKEN });
    });

    it('should throw InvalidTokenError if token row not found', async () => {
      mockPrismaService.actionToken.findFirst.mockResolvedValueOnce(null);

      await expect(
        authService.verifyResetToken(999, rawToken),
      ).rejects.toBeInstanceOf(AuthErrors.InvalidTokenError);

      expect(authService.hmacToken).not.toHaveBeenCalled();
      expect(authService.safeEqualB64url).not.toHaveBeenCalled();
      expect(mockJwt.signAsync).not.toHaveBeenCalled();
    });

    it('should throw InvalidTokenError if hash not matched', async () => {
      mockPrismaService.actionToken.findFirst.mockResolvedValueOnce({
        id: tokenId,
        tokenHash: 'storedHash',
        user: { id: user.id, name: user.name, email: user.email },
      });

      jest.spyOn(authService, 'hmacToken').mockReturnValueOnce('candidateHash');
      jest.spyOn(authService, 'safeEqualB64url').mockReturnValueOnce(false);

      await expect(
        authService.verifyResetToken(tokenId, rawToken),
      ).rejects.toBeInstanceOf(AuthErrors.InvalidTokenError);

      expect(mockJwt.signAsync).not.toHaveBeenCalled();
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
      tx.actionToken.updateMany.mockReset();
      tx.actionToken.deleteMany.mockClear();
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

      tx.actionToken.updateMany.mockResolvedValue({ count: 1 });

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
      expect(tx.actionToken.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.actionToken.updateMany).toHaveBeenCalledWith({
        where: {
          id: tokenId,
          userId,
          consumedAt: null,
          expiresAt: expect.objectContaining({ gt: expect.any(Date) }),
        },
        data: { consumedAt: expect.any(Date) },
      });

      expect(mockUsersService.updatePasswordHash).toHaveBeenCalledTimes(1);
      expect(mockUsersService.updatePasswordHash).toHaveBeenCalledWith(
        user.id,
        HASH,
        tx,
      );

      // delete unused token
      expect(tx.actionToken.deleteMany).toHaveBeenCalledTimes(1);
      expect(tx.actionToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: user.id, consumedAt: null },
      });

      // ensure we don't delete tokens before it used
      const orderUpdate = tx.actionToken.updateMany.mock.invocationCallOrder[0];
      const orderDelete = tx.actionToken.deleteMany.mock.invocationCallOrder[0];
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
      ).rejects.toBeInstanceOf(UsersErrors.UserNotFoundError);
    });

    it('should throw error if reset password and old password are the same', async () => {
      mockUsersService.findById.mockResolvedValueOnce(user);

      await expect(
        authService.confirmResetPassword(
          tokenId,
          user.id,
          newPassword,
          confirmPassword,
        ),
      ).rejects.toBeInstanceOf(AuthErrors.PasswordReuseError);
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
      tx.actionToken.updateMany.mockReturnValueOnce({ count: 0 });

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
