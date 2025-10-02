import { DomainError } from '../domain-error.base';
export function dataAs<T>(err: DomainError<any>): T | undefined {
  return err?.data as T | undefined;
}
