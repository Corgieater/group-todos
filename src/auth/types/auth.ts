export interface AccessTokenPayload {
  sub: number;
  userName: string;
  email: string;
}

export interface AuthUpdatePasswordPayload {
  userId: number;
  email: string;
  oldPassword: string;
  newPassword: string;
}
