import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from 'src/users/users.service';
import { ActionTokenType } from 'src/generated/prisma/enums';
import { type User as UserModel } from 'src/generated/prisma/client';
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
import { SecurityService } from 'src/security/security.service';
import { JwtService } from '@nestjs/jwt';

describe('AuthService', () => {
  let authService: AuthService;

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

  const mockSecurityService = {
    hash: jest.fn().mockReturnValue('argonHashed'),
    verify: jest.fn(),
    generateUrlFriendlySecret: jest
      .fn()
      .mockReturnValue('rawUrlFriendlySecret'),
    hmacToken: jest.fn().mockReturnValue('base64urlHash'),
    safeEqualB64url: jest.fn(),
  };

  const mockJwtService = {
    signAsync: jest.fn().mockResolvedValue('jwtToken'),
    verifyAsync: jest.fn(),
  };
  const mockPrismaService = {
    actionToken: {
      create: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: { update: jest.fn() },
    $transaction: jest.fn().mockImplementation(async (cb: any) => {
      const tx = {
        actionToken: mockPrismaService.actionToken,
        user: mockPrismaService.user,
      };
      return cb(tx);
    }),
  };

  const mockMailService = {
    sendPasswordReset: jest.fn(),
  };

  const mockConfigService = createMockConfig();
  const JWT_TOKEN = 'jwtToken';
  const HMAC_HASHED = 'base64urlHash';

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
        { provide: JwtService, useValue: mockJwtService },
        {
          provide: SecurityService,
          useValue: mockSecurityService,
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
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
      expect(mockSecurityService.hash).toHaveBeenCalledWith(signupDto.password);
      expect(mockUsersService.create).toHaveBeenCalledWith({
        name: 'test',
        email: 'test@test.com',
        hash: 'argonHashed',
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
      expect(mockSecurityService.hash).not.toHaveBeenCalled();
      expect(mockUsersService.create).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────────
  // signin
  // ───────────────────────────────────────────────────────────────────────────────

  describe('signin', () => {
    it('should sign user in and issue token', async () => {
      mockUsersService.findByEmail.mockResolvedValueOnce(user);
      mockSecurityService.verify.mockResolvedValueOnce(true);
      const result = await authService.signin(
        signinDto.email,
        signinDto.password,
      );

      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(
        'test@test.com',
      );
      expect(mockSecurityService.verify).toHaveBeenCalledWith('hashed', 'test');
      expect(mockJwtService.signAsync).toHaveBeenCalledWith(accessPayload);
      expect(result).toEqual({ accessToken: JWT_TOKEN });
    });

    it('should throw InvalidCredentialError when password does not match', async () => {
      mockUsersService.findByEmail.mockResolvedValueOnce(user);
      mockSecurityService.verify.mockResolvedValueOnce(false);

      await expect(
        authService.signin(signinDto.email, signinDto.password),
      ).rejects.toBeInstanceOf(AuthErrors.InvalidCredentialError);

      expect(mockJwtService.signAsync).not.toHaveBeenCalled();
    });

    it('should throw UsersNotFoundError', async () => {
      mockUsersService.findByEmail.mockResolvedValueOnce(null);

      await expect(
        authService.signin('mock@test.com', 'mock'),
      ).rejects.toBeInstanceOf(AuthErrors.UserNotFoundError);
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
      mockSecurityService.verify
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      await authService.changePassword(payload);
      expect(mockUsersService.findById).toHaveBeenCalledWith(payload.userId);
      expect(mockSecurityService.verify).toHaveBeenNthCalledWith(
        1,
        user.hash,
        payload.oldPassword,
      );
      expect(mockSecurityService.verify).toHaveBeenNthCalledWith(
        2,
        user.hash,
        payload.newPassword,
      );

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
      expect(mockUsersService.updatePasswordHash).toHaveBeenCalledWith(
        payload.userId,
        'argonHashed',
        expect.any(Object),
      );
    });

    it('should throw error when user not found', async () => {
      mockUsersService.findById.mockResolvedValueOnce(null);

      await expect(authService.changePassword(payload)).rejects.toBeInstanceOf(
        UsersErrors.UserNotFoundError,
      );

      expect(mockSecurityService.hash).not.toHaveBeenCalled();
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should throw error if old password is incorrect', async () => {
      mockUsersService.findById.mockResolvedValueOnce(user);
      mockSecurityService.verify.mockResolvedValueOnce(false);

      await expect(authService.changePassword(payload)).rejects.toBeInstanceOf(
        AuthErrors.InvalidOldPasswordError,
      );

      expect(mockSecurityService.hash).not.toHaveBeenCalled();
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should throw error if old and new password are the same', async () => {
      mockUsersService.findById.mockResolvedValueOnce(user);
      mockSecurityService.verify
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      await expect(authService.changePassword(payload)).rejects.toBeInstanceOf(
        AuthErrors.PasswordReuseError,
      );

      expect(mockSecurityService.hash).not.toHaveBeenCalled();
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
      mockUsersService.findByEmail.mockResolvedValueOnce(user);
      mockPrismaService.actionToken.upsert.mockResolvedValueOnce({
        id: tokenId,
      });

      await authService.resetPassword(user.email);

      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(
        'test@test.com',
      );

      expect(
        mockSecurityService.generateUrlFriendlySecret,
      ).toHaveBeenCalledWith(32);
      expect(mockSecurityService.hmacToken).toHaveBeenCalledWith(
        'rawUrlFriendlySecret',
        expect.any(String),
      );

      const subjectKey = `RESET_PASSWORD:user:${user.id}`;
      expect(mockPrismaService.actionToken.upsert).toHaveBeenCalledWith({
        where: { subjectKey },
        update: {
          tokenHash: HMAC_HASHED,
          expiresAt: expect.any(Date),
          consumedAt: null,
          revokedAt: null,
        },
        create: {
          type: ActionTokenType.RESET_PASSWORD,
          subjectKey,
          tokenHash: HMAC_HASHED,
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
      mockSecurityService.hmacToken.mockReturnValueOnce(STORED_HASH);
      mockSecurityService.safeEqualB64url.mockReturnValueOnce(true);

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

      expect(mockSecurityService.hmacToken).toHaveBeenCalledWith(
        rawToken,
        expect.any(String),
      );
      expect(mockSecurityService.safeEqualB64url).toHaveBeenCalledWith(
        STORED_HASH,
        STORED_HASH,
      );

      expect(mockJwtService.signAsync).toHaveBeenCalledWith(
        {
          tokenUse: 'resetPassword',
          sub: user.id,
          userName: user.name,
          email: user.email,
          tokenId,
        },
        { expiresIn: '10m' },
      );
      expect(result).toEqual({ accessToken: JWT_TOKEN });
    });

    it('should throw InvalidTokenError if token row not found', async () => {
      mockPrismaService.actionToken.findFirst.mockResolvedValueOnce(null);

      await expect(
        authService.verifyResetToken(999, rawToken),
      ).rejects.toBeInstanceOf(AuthErrors.InvalidTokenError);

      expect(mockSecurityService.hmacToken).not.toHaveBeenCalled();
      expect(mockSecurityService.safeEqualB64url).not.toHaveBeenCalled();
      expect(mockJwtService.signAsync).not.toHaveBeenCalled();
    });

    it('should throw InvalidTokenError if hash not matched', async () => {
      mockPrismaService.actionToken.findFirst.mockResolvedValueOnce({
        id: tokenId,
        tokenHash: 'storedHash',
        user: { id: user.id, name: user.name, email: user.email },
      });

      await expect(
        authService.verifyResetToken(tokenId, rawToken),
      ).rejects.toBeInstanceOf(AuthErrors.InvalidTokenError);

      expect(mockJwtService.signAsync).not.toHaveBeenCalled();
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
      mockPrismaService.actionToken.updateMany.mockReset();
      mockPrismaService.actionToken.deleteMany.mockClear();
      mockUsersService.updatePasswordHash.mockReset();
    });

    it('should reset password and update consumedAt', async () => {
      newPassword = 'newPassword';
      confirmPassword = 'newPassword';
      tokenId = 2;
      userId = user.id;

      mockUsersService.findById.mockResolvedValueOnce(user);
      mockSecurityService.verify.mockResolvedValueOnce(false);

      mockPrismaService.actionToken.updateMany.mockResolvedValue({ count: 1 });

      await authService.confirmResetPassword(
        tokenId,
        userId,
        newPassword,
        confirmPassword,
      );

      expect(mockUsersService.findById).toHaveBeenCalledWith(userId);
      expect(mockSecurityService.verify).toHaveBeenCalledWith(
        user.hash,
        newPassword,
      );
      expect(mockSecurityService.hash).toHaveBeenCalledWith(newPassword);

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);

      // update token have been used
      expect(mockPrismaService.actionToken.updateMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.actionToken.updateMany).toHaveBeenCalledWith({
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
        'argonHashed',
        expect.any(Object),
      );
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
      newPassword = 'password';
      confirmPassword = 'password';
      mockUsersService.findById.mockResolvedValueOnce(user);
      mockSecurityService.verify.mockResolvedValueOnce(true);

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
      mockSecurityService.verify.mockResolvedValueOnce(false);

      await expect(
        authService.confirmResetPassword(tokenId, user.id, newPassword, 'foo'),
      ).rejects.toBeInstanceOf(AuthErrors.PasswordConfirmationMismatchError);
    });

    it('should throw InvalidTokenError if count !== 1', async () => {
      mockUsersService.findById.mockResolvedValueOnce(user);
      mockSecurityService.verify.mockResolvedValueOnce(false);
      mockPrismaService.actionToken.updateMany.mockReturnValueOnce({
        count: 0,
      });

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
