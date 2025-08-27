import { DomainError } from '../domain-error.base';

type TokenKind = 'reset' | 'verify';
export class InvalidTokenError extends DomainError<{
  tokenKind: TokenKind;
}> {
  constructor(tokenKind: TokenKind, opts?: { cause?: unknown }) {
    super('InvalidTokenError', {
      code: 'INVALID_TOKEN',
      message: 'Token is invalid or expired',
      data: { tokenKind },
      cause: opts?.cause,
    });
  }

  static reset(opts?: { cause?: unknown }) {
    return new InvalidTokenError('reset', opts);
  }
  static verify(opts?: { cause?: unknown }) {
    return new InvalidTokenError('verify', opts);
  }
}
