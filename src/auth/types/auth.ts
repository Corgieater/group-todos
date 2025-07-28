export interface AccessTokenPayload {
  sub: number;
  userName: string;
  email: string;
}

export interface AuthUpdatePassword {
  userId: number;
  userName: string;
  email: string;
  oldPassword: string;
  newPassword: string;
}
