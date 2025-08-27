import { DomainError } from '../domain-error.base';

type CredentialKind = 'email' | 'password';

export class InvalidCredentialError extends DomainError<{
  credential: CredentialKind;
}> {
  constructor(credential: CredentialKind, opts?: { cause?: unknown }) {
    super('InvalidCredentialError', {
      code: 'INVALID_CREDENTIAL',
      // keep user-facing mapping generic; this message is for logs
      message: 'Invalid credentials',
      data: { credential },
      cause: opts?.cause,
    });
  }

  static password(opts?: { cause?: unknown }) {
    return new InvalidCredentialError('password', opts);
  }
}

export class CredentialDuplicatedError extends DomainError {
  constructor() {
    super('CredentialDuplicatedError', {
      code: 'CREDENTIAL_DUPLICATED',
      message: 'Duplicate email',
      data: { field: 'email' },
    });
  }
}
