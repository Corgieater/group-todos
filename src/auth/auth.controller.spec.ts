import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConflictException } from '@nestjs/common';
import { Request, Response } from 'express';

describe('AuthController', () => {
  let authController: AuthController;
  let authService: AuthService;

  const mockAuthService = {
    signup: jest.fn(),
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

  it('should call authService.signup and redirect with success lash', async () => {
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
