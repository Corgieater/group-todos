export type DomainErrorCode =
  | 'INVALID_CREDENTIAL'
  | 'INVALID_OLD_PASSWORD'
  | 'USER_NOT_FOUND'
  | 'CREDENTIAL_DUPLICATED'
  | 'INVALID_TOKEN'
  | 'PASSWORD_REUSE'
  | 'PASSWORD_CONFIRMATION_MISMATCH'
  | 'TASK_NOT_FOUND';

export interface DomainErrorParams<D = unknown> {
  message?: string; // developer-friendly default/override
  code: DomainErrorCode;
  data?: D; // structured context (e.g., { field: 'email' })
  cause?: unknown; // native Error cause (Node 16+)
}

export class DomainError<D = unknown> extends Error {
  readonly code: DomainErrorCode;
  readonly data?: D;
  readonly cause?: unknown;

  constructor(name: string, params: DomainErrorParams<D>) {
    super(params.message ?? name);
    this.name = name;
    this.code = params.code;
    this.data = params.data;
    this.cause = params.cause;

    // Keep correct stack, trim constructor frames where supported
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    // Safe to log/serialize without leaking stack by default
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      data: this.data,
    };
  }
}

export const isDomainError = (e: unknown): e is DomainError =>
  e instanceof DomainError && typeof (e as DomainError).code === 'string';
