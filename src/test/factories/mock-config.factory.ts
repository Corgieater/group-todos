import { ConfigService } from '@nestjs/config';

type AppConfig = {
  BASE_URL: string;
  JWT_SECRET: string;
  TOKEN_EXPIRE_TIME: string; // e.g. "15m"
  COOKIE_SECRET: string;
  LOGIN_COOKIE_MAX_AGE: number; // ms
  RESET_PASSWORD_COOKIE_MAX_AGE: number; // ms
};

const baseMap: AppConfig = {
  BASE_URL: 'http://localhost:3000/',
  JWT_SECRET: 'test-secret',
  TOKEN_EXPIRE_TIME: '15m',
  COOKIE_SECRET: 'cookie-secret',
  LOGIN_COOKIE_MAX_AGE: 1_440_000,
  RESET_PASSWORD_COOKIE_MAX_AGE: 900_000,
};

// NOTE:
// come back and re-read this all

export function createMockConfig(overrides: Partial<AppConfig> = {}) {
  const map: AppConfig = { ...baseMap, ...overrides };

  const get = jest.fn(
    <K extends keyof AppConfig>(
      key: K,
      defaultValue?: AppConfig[K],
    ): AppConfig[K] => {
      return key in map ? map[key] : (defaultValue as AppConfig[K]);
    },
  );

  const mock: Pick<ConfigService, 'get'> = { get } as any;

  return {
    mock,
    map,
    clear: () => {
      get.mockClear();
    },
  };
}
