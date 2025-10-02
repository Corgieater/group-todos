import { DomainError } from '../domain-error.base';
export type InvalidCredentialData = {
  reason: 'bad_password';
  by?: 'email'; // 只保留 email（可選）
  email?: string; // 可選：要不要在 log 裡記 email 由你決定
};

export type CredentialDuplicatedData = {
  field: 'email' | string; // 之後想擴充 username/phone 也OK
  value?: string; // 可選：要不要把重複值記進 log 由你決定
};

export class InvalidCredentialError extends DomainError<InvalidCredentialData> {
  readonly reason = 'bad_password' as const;
  readonly by?: 'email';
  readonly email?: string;

  private constructor(data: InvalidCredentialData, opts?: { cause?: unknown }) {
    super('InvalidCredentialError', {
      code: 'INVALID_CREDENTIAL',
      message: 'Invalid credentials.', // 對外中性訊息
      data, // 給 log 的上下文（可含 email）
      cause: opts?.cause,
    });
    this.by = data.by;
    this.email = data.email;
  }

  static password(opts?: { cause?: unknown }) {
    return new InvalidCredentialError({ reason: 'bad_password' }, opts);
  }
}

export class CredentialDuplicatedError extends DomainError<CredentialDuplicatedData> {
  readonly field: string;
  readonly value?: string;

  private constructor(
    data: CredentialDuplicatedData,
    opts?: { cause?: unknown },
  ) {
    super('CredentialDuplicatedError', {
      code: 'CREDENTIAL_DUPLICATED',
      message: 'Duplicate credential.', // 中性，給 UI 的 fallback
      data, // 給工程師看的結構化上下文
      cause: opts?.cause, // 串底層錯誤（如 Prisma UniqueViolation）
    });
    this.field = data.field;
    this.value = data.value;
  }

  /** 你要的靜態工廠：重複的 email */
  static email(email: string, opts?: { cause?: unknown }) {
    return new CredentialDuplicatedError(
      { field: 'email', value: email },
      opts,
    );
  }

  /** 可選：之後要擴充其它欄位可以用這個 */
  static of(field: string, value?: string, opts?: { cause?: unknown }) {
    return new CredentialDuplicatedError({ field, value }, opts);
  }
}
