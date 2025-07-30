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
} from 'src/test/factories/mock-user.factory';
import { UserPayload } from 'src/common/types/user-payload';
import { AuthUpdatePasswordDto } from './dto/auth.dto';
import { AuthUpdatePasswordPayload } from './types/auth';
describe('AuthController', () => {
  let authController: AuthController;

  let mockReq: Request;
  let mockRes: Response;
  let mockUser: UserPayload;

  let authSignupDto: {
    name: string;
    email: string;
    password: string;
    inviteCode?: string;
  };

  let authSigninDto: {
    email: string;
    password: string;
  };
  const mockAuthService = {
    signup: jest.fn(),
    signin: jest.fn(),
    changePassword: jest.fn(),
  };

  beforeEach(async () => {
    mockReq = {
      session: {} as Record<string, any>,
    } as unknown as Request;

    mockRes = {
      redirect: jest.fn(),
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    } as unknown as Response;

    mockUser = {
      userId: 1,
      userName: 'test',
      email: 'test@test.com',
    };

    authSignupDto = createMockSignupDto();
    authSigninDto = createMockSigninDto();
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
    it('should sign user up and redirect with success flash', async () => {
      mockAuthService.signup.mockResolvedValueOnce(undefined);
      await authController.signup(mockReq, authSignupDto, mockRes);
      expect(mockAuthService.signup).toHaveBeenCalledWith(authSignupDto);
      expect(mockReq.session.flash).toEqual({
        type: 'success',
        message: 'Account apply succeed, please login!',
      });
      expect(mockRes.redirect).toHaveBeenCalledWith('/');
    });

    it('should redirect with error flash when email already taken', async () => {
      mockAuthService.signup.mockRejectedValueOnce(new ConflictException());
      await authController.signup(mockReq, authSignupDto, mockRes);
      expect(mockAuthService.signup).toHaveBeenCalledWith(authSignupDto);
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
      await authController.signin(mockReq, authSigninDto, mockRes);
      expect(mockRes.cookie).toHaveBeenCalledWith('jwt', 'jwtToken');
      expect(mockRes.redirect).toHaveBeenLastCalledWith('/users/home');
    });

    it('should redirect to /auth/signin when credentials are invalid', async () => {
      mockAuthService.signin.mockRejectedValueOnce(new UnauthorizedException());
      await authController.signin(mockReq, authSigninDto, mockRes);
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
        ...mockUser,
        ...dto,
      };
    });
    it('should change user password, clear cookie and redirect to /', async () => {
      await authController.changePassword(mockReq, mockUser, dto, mockRes);
      expect(mockAuthService.changePassword).toHaveBeenCalledWith(payload);
      expect(mockReq.session.flash).toEqual({
        type: 'success',
        message: 'Password changed',
      });
      expect(mockRes.clearCookie).toHaveBeenCalledWith('jwt');
      expect(mockRes.redirect).toHaveBeenCalledWith('/');
    });

    it('should set error flash message Old password is incorrect and redirect to /users/home', async () => {
      mockAuthService.changePassword.mockRejectedValueOnce(
        new ForbiddenException('Old password is incorrect'),
      );
      await authController.changePassword(mockReq, mockUser, dto, mockRes);
      expect(mockReq.session.flash).toEqual({
        type: 'error',
        message: 'Old password is incorrect',
      });
      expect(mockRes.redirect).toHaveBeenCalledWith('/users/home');
    });

    it('should set error flash message Please use a new password and redirect to /users/home', async () => {
      mockAuthService.changePassword.mockRejectedValueOnce(
        new BadRequestException('Please use a new password'),
      );
      await authController.changePassword(mockReq, mockUser, dto, mockRes);
      expect(mockReq.session.flash).toEqual({
        type: 'error',
        message: 'Please use a new password',
      });
      expect(mockRes.redirect).toHaveBeenCalledWith('/users/home');
    });
  });
});
