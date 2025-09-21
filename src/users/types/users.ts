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

// we might not need this
export interface UserUpdatePayload {
  id: number;
  name?: string;
  hash?: string;
  tokenId?: number;
}
