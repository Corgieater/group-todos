export interface UserInfo {
  id: number;
  email: string;
  name: string;
  hash: string;
}

export interface UserCreatePayload {
  name: string;
  email: string;
  hash: string;
}

export interface UserUpdatePayload {
  id: number;
  name?: string;
  hash?: string;
}
