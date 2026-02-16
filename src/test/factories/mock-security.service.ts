export const createMockSecurityService = () => ({
  hash: jest.fn().mockReturnValue('argonHashed'),
  verify: jest.fn(),
  generateUrlFriendlySecret: jest.fn().mockReturnValue('rawUrlFriendlySecret'),
  hmacToken: jest.fn().mockReturnValue('base64urlHash'),
  safeEqualB64url: jest.fn(),
  signResetPasswordToken: jest.fn().mockResolvedValue('mock-reset-token'),
  signAccessToken: jest.fn().mockResolvedValue('mock-access-token'),
  getCookieOptions: jest.fn(),
});
