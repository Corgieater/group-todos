export interface UserInfo {
  id: number;
  name: string;
  hash: string;
}

export interface UserCreatePayload {
  name: string;
  email: string;
  hash: string;
}
