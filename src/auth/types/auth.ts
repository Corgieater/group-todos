export interface BaseAccessTokenPayload {
  sub: number;
  userName: string | null;
  email: string;
}

export interface NormalAccessTokenPayload extends BaseAccessTokenPayload {
  tokenUse: 'access';
}

export interface ResetAccessTokenPayload extends BaseAccessTokenPayload {
  tokenUse: 'resetPassword';
  tokenId: number;
}

export interface AuthUpdatePasswordPayload {
  userId: number;
  email: string;
  oldPassword: string;
  newPassword: string;
}

export interface AuthResetPasswordPayload {
  userId: number;
  tokenUse: string;
  userName: string;
  email: string;
  tokenId: number;
}
