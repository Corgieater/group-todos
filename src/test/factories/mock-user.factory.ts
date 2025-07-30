import { User as UserModel } from '@prisma/client';
import { AuthSigninDto, AuthSignupDto } from 'src/auth/dto/auth.dto';
import { CurrentUser } from 'src/common/types/current-user';

export function createMockSignupDto(overrides?: Partial<AuthSignupDto>) {
  return {
    name: 'test',
    email: 'test@test.com',
    password: 'test',
    ...overrides,
  };
}

export function createMockSigninDto(overrides?: Partial<AuthSigninDto>) {
  return {
    email: 'test@test.com',
    password: 'test',
    ...overrides,
  };
}

export function createMockCreatePayload(
  overrides?: Partial<{ email: string; password: string }>,
) {
  return {
    name: 'test',
    email: 'test@test.com',
    hash: 'hashed',
    ...overrides,
  };
}

export function createMockUser(overrides?: Partial<UserModel>) {
  return {
    id: 1,
    email: 'test@test.com',
    name: 'test',
    hash: 'hashed',
    ...overrides,
  };
}

export function createMockCurrentUser(overrides?: Partial<CurrentUser>) {
  return {
    userId: 1,
    userName: 'test',
    email: 'test@test.com',
    ...overrides,
  };
}
