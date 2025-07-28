export function createMockSignupDto(
  overrides?: Partial<{ name: string; email: string; password: string }>,
) {
  return {
    name: 'test',
    email: 'test@test.com',
    password: 'test',
    ...overrides,
  };
}

export function createMockSigninDto(
  overrides?: Partial<{ email: string; password: string }>,
) {
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

export function createMockUser(
  overrides?: Partial<{
    id: number;
    email: string;
    name: string;
    hash: string;
  }>,
) {
  return {
    id: 1,
    email: 'test@test.com',
    name: 'test',
    hash: 'hashed',
    ...overrides,
  };
}
