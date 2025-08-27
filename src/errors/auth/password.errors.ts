import { DomainError } from '../domain-error.base';

export class PasswordReuseError extends DomainError {
  constructor() {
    super('PasswordReuseError', {
      code: 'PASSWORD_REUSE',
      message: 'Password was reused',
    });
  }
}

export class PasswordConfirmationMismatchError extends DomainError {
  constructor() {
    super('PasswordConfirmationMismatchError', {
      code: 'PASSWORD_CONFIRMATION_MISMATCH',
      message: 'Password confirmation does not match',
    });
  }
}

export class InvalidOldPasswordError extends DomainError {
  constructor() {
    super('InvalidOldPasswordError', {
      code: 'INVALID_OLD_PASSWORD', // change-password only
      message: 'Old password is invalid',
    });
  }
}
