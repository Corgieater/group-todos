import { HttpStatus } from '@nestjs/common';
import { makeRedirectHandler } from 'src/common/types/domain-error-page.types';
import type { Handler } from 'src/common/types/domain-error-page.types';
import type { Request } from 'express';

const backOr = (fallback: string) => (req: Request) =>
  req.get('referer') ?? fallback;

export const globalDomainErrorMap: Partial<Record<string, Handler>> = {
  USER_NOT_FOUND: makeRedirectHandler(backOr('/users'), {
    semanticStatus: HttpStatus.NOT_FOUND,
    msg: () => 'User not found.',
  }),
};
