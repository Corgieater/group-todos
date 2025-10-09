import { DomainError } from '../domain-error.base';

type TokenKind = 'reset' | 'verify' | 'invite';
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
  // TODO:
  // how to make them more infomative? like adding what the cause?
  // reset doesn't sounds clear? who? how reset what?
  static reset(opts?: { cause?: unknown }) {
    return new InvalidTokenError('reset', opts);
  }
  static verify(opts?: { cause?: unknown }) {
    return new InvalidTokenError('verify', opts);
  }
  static invite(opts?: { cause?: unknown }) {
    return new InvalidTokenError('invite', opts);
  }
}
