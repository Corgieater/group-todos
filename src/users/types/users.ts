export interface UserInfo {
  id: number;
  email: string;
  name: string;
  hash: string;
}

export interface UserCreatePayload {
  name: string;
  email: string;
  timeZone: string;
  hash: string;
}
