export interface BaseAccessTokenPayload {
  sub: number;
  userName: string | null;
  email: string;
}

export interface BaseAccessTokenPayload {
  sub: number;
  userName: string | null;
  email: string;
}

export interface UserAccessInfo extends BaseAccessTokenPayload {
  timeZone: string;
}

export interface UserResetPasswordInfo extends BaseAccessTokenPayload {
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
