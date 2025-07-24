export interface UserInfo {
  id: number;
  name: string;
  hash: string;
}

export interface CreateUserInput {
  name: string;
  email: string;
  hash: string;
}
