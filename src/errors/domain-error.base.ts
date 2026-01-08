export type DomainErrorCode =
  | 'INVALID_CREDENTIAL'
  | 'INVALID_OLD_PASSWORD'
  | 'USER_NOT_FOUND'
  | 'CREDENTIAL_DUPLICATED'
  | 'INVALID_TOKEN'
  | 'PASSWORD_REUSE'
  | 'PASSWORD_CONFIRMATION_MISMATCH'
  | 'TASK_NOT_FOUND'
  | 'TASK_EMPTY_UPDATE'
  | 'TASK_STATUS_INVALID'
  | 'TASK_FORBIDDEN'
  | 'GROUP_NOT_FOUND'
  | 'CANNOT_INVITE_SELF'
  | 'ALREADY_MEMBER'
  | 'NOT_AUTHORIZED_TO_REMOVE_MEMBER'
  | 'GROUP_MEMBER_NOT_FOUND'
  | 'OWNER_REMOVAL_FORBIDDEN'
  | 'GROUP_PERMISSION'
  | 'NOT_AUTHORIZED_TO_INVITE_MEMBER'
  | 'NOT_AUTHORIZED_TO_UPDATE_MEMBER_ROLE'
  | 'OWNER_DOWNGRADE_FORBIDDEN'
  | 'OWNER_ROLE_CHANGE_FORBIDDEN'
  | 'OWNER_CAN_NOT_LEAVE_THE_GROUP';

export interface DomainErrorParams<D = unknown> {
  message?: string; // developer-friendly default/override
  code: DomainErrorCode;
  data?: D; // structured context (e.g., { field: 'email' })
  cause?: unknown; // native Error cause (Node 16+)
}

export class DomainError<D = unknown> extends Error {
  readonly code: DomainErrorCode;
  readonly data?: D;
  readonly action?: string;
  readonly cause?: unknown;
  readonly actorId: number;

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
