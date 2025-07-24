import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';

describe('AuthController', () => {
  let authController: AuthController;
  let authService: AuthService;

  const mockAuthService = {
    signup: jest.fn(),
    signin: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    authController = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('signup', () => {
    it('should call authService.signup and redirect with success flash', async () => {
      const mockReq = {
        session: {} as Record<string, any>,
      } as unknown as Request;

      const mockRes = {
        redirect: jest.fn(),
      } as unknown as Response;
      const dto = {
        name: 'test',
        email: 'test@test.com',
        password: 'test',
      };

      mockAuthService.signup.mockResolvedValueOnce(undefined);
      await authController.signup(mockReq, dto, mockRes);
      expect(authService.signup).toHaveBeenCalledWith(dto);
      expect(mockReq.session.flash).toEqual({
        type: 'success',
        message: 'Account apply succeed, please login!',
      });
      expect(mockRes.redirect).toHaveBeenCalledWith('/');
    });
    it('should set error flash and redirect if email already taken', async () => {
      const mockReq = {
        session: {},
      } as unknown as Request;

      const mockRes = {
        redirect: jest.fn(),
      } as unknown as Response;
      const dto = {
        name: 'test',
        email: 'test@test.com',
        password: 'test',
      };

      mockAuthService.signup.mockRejectedValueOnce(new ConflictException());
      await authController.signup(mockReq, dto, mockRes);
      expect(authService.signup).toHaveBeenCalledWith(dto);
      expect(mockReq.session.flash).toEqual({
        type: 'error',
        message: 'Email already taken',
      });
      expect(mockRes.redirect).toHaveBeenCalledWith('/auth/signup');
    });
  });
  describe('signin', () => {
    it('should call authService.signin, add jwt at cookie and redirect to users/home', async () => {
      const mockReq = { session: {} } as unknown as Request;
      const mockRes = {
        cookie: jest.fn(),
        redirect: jest.fn(),
      } as unknown as Response;
      const dto = {
        email: 'test@test.com',
        password: 'test',
      };
      mockAuthService.signin.mockResolvedValueOnce({
        access_token: 'jwtToken',
      });
      await authController.signin(mockReq, dto, mockRes);
      expect(mockRes.cookie).toHaveBeenCalledWith('jwt', 'jwtToken');
      expect(mockRes.redirect).toHaveBeenLastCalledWith('/users/home');
    });
    it('should catch 401 unauthorized, set session.flash and redirect to /auth/signin', async () => {
      const mockReq = { session: {} } as unknown as Request;
      const mockRes = {
        cookie: jest.fn(),
        redirect: jest.fn(),
      } as unknown as Response;
      const dto = {
        email: 'test@test.com',
        password: 'test',
      };
      mockAuthService.signin.mockRejectedValueOnce(new UnauthorizedException());
      await authController.signin(mockReq, dto, mockRes);
      expect(mockReq.session.flash).toEqual({
        type: 'error',
        message: 'Invalid credentials',
      });
      expect(mockRes.redirect).toHaveBeenCalledWith('/auth/signin');
    });
  });
});
