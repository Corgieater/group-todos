import { DomainError } from '../domain-error.base';

export type UserLookup =
  | { by: 'email'; email: string }
  | { by: 'id'; id: number };

export class UserNotFoundError extends DomainError<UserLookup> {
  readonly email?: string;
  readonly id?: number;

  private constructor(data: UserLookup, opts?: { cause?: unknown }) {
    super('UserNotFoundError', {
      code: 'USER_NOT_FOUND',
      message: `User not found.`,
      data,
      cause: opts?.cause,
    });
    if (data.by === 'email') this.email = data.email;
    else this.id = data.id;
  }

  static byEmail(email: string, opts?: { cause?: unknown }) {
    return new UserNotFoundError({ by: 'email', email }, opts);
  }

  static byId(id: number, opts?: { cause?: unknown }) {
    return new UserNotFoundError({ by: 'id', id }, opts);
  }
}
