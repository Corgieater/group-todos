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

export function createMockUser(
  overrides?: Partial<{ id: number; name: string; hash: string }>,
) {
  return {
    id: 1,
    name: 'test',
    hash: 'hashed',
    ...overrides,
  };
}
