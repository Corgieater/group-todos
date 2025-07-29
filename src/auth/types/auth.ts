export interface AccessTokenPayload {
  sub: number;
  userName: string;
  email: string;
}

export interface AuthUpdatePasswordPayload {
  userId: number;
  userName: string;
  email: string;
  oldPassword: string;
  newPassword: string;
}
