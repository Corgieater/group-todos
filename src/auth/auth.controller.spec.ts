import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Request, Response } from 'express';
import {
  createMockSignupDto,
  createMockSigninDto,
  createMockCurrentUser,
} from 'src/test/factories/mock-user.factory';
import {
  AuthForgotPasswordDto,
  AuthResetPasswordDto,
  AuthSigninDto,
  AuthSignupDto,
  AuthUpdatePasswordDto,
} from './dto/auth.dto';
import { AuthUpdatePasswordPayload } from './types/auth';
import {
  createMockReq,
  createMockRes,
} from 'src/test/factories/mock-http.factory';
import { CurrentUser } from 'src/common/types/current-user';
import { ConfigService } from '@nestjs/config';
import { createMockConfig } from 'src/test/factories/mock-config.factory';

describe('AuthController', () => {
  let authController: AuthController;

  let req: Request;
  let res: Response;
  let currentUser: CurrentUser;
  let accessToken: { accessToken: string };

  const mockAuthService = {
    signup: jest.fn(),
    signin: jest.fn(),
    changePassword: jest.fn(),
    resetPassword: jest.fn(),
    verifyResetToken: jest.fn(),
    confirmResetPassword: jest.fn(),
  };

  const mockConfigService = createMockConfig();

  beforeEach(async () => {
    jest.clearAllMocks();
    req = createMockReq();
    res = createMockRes();
    currentUser = createMockCurrentUser();
    accessToken = { accessToken: 'jwtToken' };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: ConfigService, useValue: mockConfigService.mock },
      ],
    }).compile();

    authController = module.get<AuthController>(AuthController);
  });

  describe('signup', () => {
    let dto: AuthSignupDto;

    beforeEach(() => {
      dto = createMockSignupDto();
    });

    it('should redirect with success flash when user signs up successfully', async () => {
      mockAuthService.signup.mockResolvedValueOnce(undefined);
      await authController.signup(req, dto, res);
      expect(mockAuthService.signup).toHaveBeenCalledWith(dto);
      expect(req.session.flash).toEqual({
        type: 'success',
        message: 'Account apply succeed, please login!',
      });
      expect(res.redirect).toHaveBeenCalledWith('/');
    });
  });

  describe('signin', () => {
    let dto: AuthSigninDto;

    beforeEach(() => {
      dto = createMockSigninDto();
    });

    it('should sign in user and redirect with token', async () => {
      mockAuthService.signin.mockResolvedValueOnce(accessToken);
      await authController.signin(req, dto, res);
      expect(res.cookie).toHaveBeenCalledWith('grouptodo_login', 'jwtToken', {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: mockConfigService.mock.get<number>('LOGIN_COOKIE_MAX_AGE'),
      });
      expect(res.redirect).toHaveBeenCalledWith('/tasks/home');
    });
  });

  describe('signout', () => {
    it('should sign out user and redirect with success message', () => {
      authController.signout(req, res);
      expect(res.clearCookie).toHaveBeenCalledWith('grouptodo_login');
      expect(req.session.flash).toEqual({
        type: 'success',
        message: 'Signed out successfully',
      });
      expect(res.redirect).toHaveBeenCalledWith('/');
    });
  });

  describe('changePassword', () => {
    let dto: AuthUpdatePasswordDto;
    let payload: AuthUpdatePasswordPayload;

    beforeEach(() => {
      dto = {
        oldPassword: 'test',
        newPassword: 'foo',
      };
      payload = {
        userId: currentUser.userId,
        email: currentUser.email,
        ...dto,
      };
    });

    it('should change user password, clear cookie and redirect to /', async () => {
      await authController.changePassword(req, currentUser, dto, res);
      expect(mockAuthService.changePassword).toHaveBeenCalledWith(payload);
      expect(req.session.flash).toEqual({
        type: 'success',
        message: 'Password changed',
      });
      expect(res.clearCookie).toHaveBeenCalledWith('grouptodo_login');
      expect(res.redirect).toHaveBeenCalledWith('/');
    });
  });

  describe('resetPassword', () => {
    let dto: AuthForgotPasswordDto;
    dto = {
      email: 'test@test.com',
    };

    it('should always redirect with a success flash message', async () => {
      await authController.resetPassword(req, dto, res);

      expect(mockAuthService.resetPassword).toHaveBeenCalledWith(dto.email);
      expect(req.session.flash).toEqual({
        type: 'success',
        message:
          'If this email is registered, a password reset link has been sent.',
      });
      expect(res.redirect).toHaveBeenCalledWith('/');
    });
  });

  describe('verifyResetToken', () => {
    let tokenId: number;
    let resetPasswordToken: string;

    beforeEach(() => {
      tokenId = 1;
      resetPasswordToken = 'reset-password-token';
    });

    it('should return reset password form page after token verified', async () => {
      mockAuthService.verifyResetToken.mockResolvedValueOnce(accessToken);
      await authController.verifyResetToken(
        req,
        tokenId,
        resetPasswordToken,
        res,
      );

      expect(mockAuthService.verifyResetToken).toHaveBeenCalledWith(
        tokenId,
        resetPasswordToken,
      );

      expect(res.cookie).toHaveBeenCalledWith(
        'grouptodo_reset_password',
        'jwtToken',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          maxAge: mockConfigService.mock.get<number>(
            'RESET_PASSWORD_COOKIE_MAX_AGE',
          ),
        }),
      );
      expect(res.redirect).toHaveBeenCalledWith('/auth/reset-password');

      expect((req.session as any).flash).toEqual(
        expect.objectContaining({ type: 'success' }),
      );
    });
  });

  describe('confirmResetPassword', () => {
    const payload = { userId: 1, tokenId: 2 };
    const dto: AuthResetPasswordDto = {
      newPassword: 'newPassword',
      confirmPassword: 'newPassword',
    };

    beforeEach(() => {
      req = createMockReq({ user: payload });
    });

    it('should reset password and redirect to / with success message', async () => {
      await authController.confirmResetPassword(req, dto, res);

      expect(mockAuthService.confirmResetPassword).toHaveBeenCalledWith(
        payload.tokenId,
        payload.userId,
        dto.newPassword,
        dto.confirmPassword,
      );
      expect(res.clearCookie).toHaveBeenCalledWith('grouptodo_reset_password');
      expect(req.session.flash?.type).toEqual('success');
      expect(req.session.flash?.message).toEqual(
        'Reset password succeed, please re-login!',
      );
      expect(res.redirect).toHaveBeenCalledWith('/');
    });
  });
});
