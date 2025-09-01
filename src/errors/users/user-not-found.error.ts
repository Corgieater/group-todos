import { DomainError } from '../domain-error.base';

type UserLookup = { by: 'email'; email: string } | { by: 'id'; id: number };

export class UserNotFoundError extends DomainError<UserLookup> {
  private constructor(data: UserLookup, opts?: { cause?: unknown }) {
    super('UserNotFoundError', {
      code: 'USER_NOT_FOUND',
      message: 'User was not found',
      data,
      cause: opts?.cause, // <- forward cause
    });
  }

  static byEmail(email: string, opts?: { cause?: unknown }) {
    return new UserNotFoundError({ by: 'email', email }, opts);
  }

  static byId(id: number, opts?: { cause?: unknown }) {
    return new UserNotFoundError({ by: 'id', id }, opts);
  }
}
