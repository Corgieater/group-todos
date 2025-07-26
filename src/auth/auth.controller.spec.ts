import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import {
  createMockSignupDto,
  createMockSigninDto,
} from 'src/test/factories/mock-user.factory';

describe('AuthController', () => {
  let authController: AuthController;

  let mockReq: Request;
  let mockRes: Response;

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
  };

  beforeEach(async () => {
    mockReq = {
      session: {} as Record<string, any>,
    } as unknown as Request;

    mockRes = {
      redirect: jest.fn(),
      cookie: jest.fn(),
    } as unknown as Response;

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
    it('signs in user and redirects with token', async () => {
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
});
