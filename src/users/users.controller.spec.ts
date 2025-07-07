import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';

// import { MockContext, Context, createMockContext } from '../context';
import { UsersService } from './users.service';

// !!! read gpt again and see what it provide
// write other test

// let mockCtx: MockContext;
// let ctx: Context;
let usersController: UsersController;
let mockUsersService: UsersService;
//  this part is for typescript, define types

beforeEach(async () => {
  // we tell Nest to injection stuff here, although i am not sure if e2e and service tests are all in different files, how Nest will inject this to other test? or this pattern just means I don't need to mock dependencies one by one? if so, I guess it will be better to manul mocking in controller tests? since controller don't usually have lots of dependencies
  const module: TestingModule = await Test.createTestingModule({
    controllers: [UsersController],
    providers: [{ provide: UsersService, useValue: { create: jest.fn() } }],
  }).compile();
  // i think above is a map for Nest to see what to use?

  usersController = module.get<UsersController>(UsersController);
  mockUsersService = module.get<UsersService>(UsersService);
  // this part declare the real object to use???
});
// testing, i think it being reasonable
it('should call usersService and redirect to /', async () => {
  const userData = {
    userName: 'test',
    email: 'test@gmail.com',
    password: 'test',
  };
  const mockRes = {
    redirect: jest.fn(),
  } as unknown as any;
  await usersController.create(userData, mockRes);
  expect(mockUsersService.create).toHaveBeenCalledWith(userData);
  expect(mockRes.redirect).toHaveBeenCalledWith('/');
});
// beforeEach(() => {
//   mockCtx = createMockContext();
//   ctx = mockCtx as unknown as Context;
//   usersService = new UsersService();
//   usersController = new UsersController(usersService);
// });

// test('should call userService and redirect to /', async () => {
//   const userData = {
//     userName: 'test',
//     email: 'test@gmail.com',
//     password: 'test',
//   };
//   const mockRes = { redirect: jest.fn() } as any;
//   await usersController.create(userData, mockRes);
//   expect(usersService.create).toHaveBeenCalledWith(userData);
//   expect(mockRes.redirect).toHaveBeenCalledWith('/');
// });
// describe('UsersController', () => {
//   let controller: UsersController;

//   beforeEach(async () => {
//     // const module: TestingModule = await Test.createTestingModule({
//     //   controllers: [UsersController],
//     //   providers: [UsersService],
//     // }).compile();
//     // controller = module.get<UsersController>(UsersController);
//     const mockUsersService = jest.fn();
//     const usersController = new UsersController(mockUsersService);
//   });

//   it('should be defined', () => {
//     expect(controller).toBeDefined();
//   });
// });
