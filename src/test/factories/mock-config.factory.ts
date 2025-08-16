type ConfigMap = Record<string, unknown>;

const baseMap: ConfigMap = {
  BASE_URL: 'http://localhost:3000/',
  JWT_SECRET: 'test-secret',
  TOKEN_EXPIRE_TIME: '15m',
  COOKIE_SECRET: 'cookie-secret',
  LOGIN_COOKIE_MAX_AGE: 1440000,
};

export function createMockConfig(overrides: Partial<ConfigMap> = {}) {
  const map: ConfigMap = { ...baseMap, ...overrides };

  const get = jest.fn(<T = any>(key: string, defaultValue?: T): T => {
    const has = Object.prototype.hasOwnProperty.call(map, key);

    return (has ? (map[key] as T) : defaultValue) as T;
  });

  return {
    mock: { get },
    map,
    clear: () => get.mockClear(),
  };
}
