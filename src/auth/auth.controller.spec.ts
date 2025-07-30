import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  createMockSignupDto,
  createMockSigninDto,
  createMockCurrentUser,
} from 'src/test/factories/mock-user.factory';
import {
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
describe('AuthController', () => {
  let authController: AuthController;

  let mockReq: Request;
  let mockRes: Response;
  let mockCurrentUser: CurrentUser;

  let mockAuthSignupDto: AuthSignupDto;
  let mockAuthSigninDto: AuthSigninDto;

  const mockAuthService = {
    signup: jest.fn(),
    signin: jest.fn(),
    changePassword: jest.fn(),
  };

  beforeEach(async () => {
    mockReq = createMockReq();
    mockRes = createMockRes();
    mockCurrentUser = createMockCurrentUser();

    mockAuthSignupDto = createMockSignupDto();
    mockAuthSigninDto = createMockSigninDto();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    authController = module.get<AuthController>(AuthController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('signup', () => {
    it('should redirect with success flash when user signs up successfully', async () => {
      mockAuthService.signup.mockResolvedValueOnce(undefined);
      await authController.signup(mockReq, mockAuthSignupDto, mockRes);
      expect(mockAuthService.signup).toHaveBeenCalledWith(mockAuthSignupDto);
      expect(mockReq.session.flash).toEqual({
        type: 'success',
        message: 'Account apply succeed, please login!',
      });
      expect(mockRes.redirect).toHaveBeenCalledWith('/');
    });

    it('should redirect with error flash when email is already taken', async () => {
      mockAuthService.signup.mockRejectedValueOnce(new ConflictException());
      await authController.signup(mockReq, mockAuthSignupDto, mockRes);
      expect(mockAuthService.signup).toHaveBeenCalledWith(mockAuthSignupDto);
      expect(mockReq.session.flash).toEqual({
        type: 'error',
        message: 'Email already taken',
      });
      expect(mockRes.redirect).toHaveBeenCalledWith('/auth/signup');
    });
  });

  describe('signin', () => {
    it('should sign in user and redirect with token', async () => {
      mockAuthService.signin.mockResolvedValueOnce({
        access_token: 'jwtToken',
      });
      await authController.signin(mockReq, mockAuthSigninDto, mockRes);
      expect(mockRes.cookie).toHaveBeenCalledWith('jwt', 'jwtToken');
      expect(mockRes.redirect).toHaveBeenLastCalledWith('/users/home');
    });

    it('should redirect to /auth/signin when credentials are invalid', async () => {
      mockAuthService.signin.mockRejectedValueOnce(new UnauthorizedException());
      await authController.signin(mockReq, mockAuthSigninDto, mockRes);
      expect(mockReq.session.flash).toEqual({
        type: 'error',
        message: 'Invalid credentials',
      });
      expect(mockRes.redirect).toHaveBeenCalledWith('/auth/signin');
    });
  });

  describe('signout', () => {
    it('should sign out user and redirect with success message', () => {
      authController.signout(mockReq, mockRes);
      expect(mockRes.clearCookie).toHaveBeenCalledWith('jwt');
      expect(mockReq.session.flash).toEqual({
        type: 'success',
        message: 'Signed out successfully',
      });
      expect(mockRes.redirect).toHaveBeenCalledWith('/');
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
        userId: mockCurrentUser.userId,
        email: mockCurrentUser.email,
        ...dto,
      };
    });

    it('should change user password, clear cookie and redirect to /', async () => {
      await authController.changePassword(
        mockReq,
        mockCurrentUser,
        dto,
        mockRes,
      );
      expect(mockAuthService.changePassword).toHaveBeenCalledWith(payload);
      expect(mockReq.session.flash).toEqual({
        type: 'success',
        message: 'Password changed',
      });
      expect(mockRes.clearCookie).toHaveBeenCalledWith('jwt');
      expect(mockRes.redirect).toHaveBeenCalledWith('/');
    });

    it('should redirect with error flash when old password is wrong', async () => {
      mockAuthService.changePassword.mockRejectedValueOnce(
        new ForbiddenException('Old password is incorrect'),
      );
      await authController.changePassword(
        mockReq,
        mockCurrentUser,
        dto,
        mockRes,
      );
      expect(mockReq.session.flash).toEqual({
        type: 'error',
        message: 'Old password is incorrect',
      });
      expect(mockRes.redirect).toHaveBeenCalledWith('/users/home');
    });

    it('should redirect with error flash when old and new password are the same', async () => {
      mockAuthService.changePassword.mockRejectedValueOnce(
        new BadRequestException('Please use a new password'),
      );
      await authController.changePassword(
        mockReq,
        mockCurrentUser,
        dto,
        mockRes,
      );
      expect(mockReq.session.flash).toEqual({
        type: 'error',
        message: 'Please use a new password',
      });
      expect(mockRes.redirect).toHaveBeenCalledWith('/users/home');
    });
  });
});
