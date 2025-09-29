import { HttpStatus } from '@nestjs/common';
import { createDomainErrorPageFilter } from './factory/create-domain-error-page-filter';
import { makeRedirectHandler } from '../types/domain-error-page.types';

export const TasksPageFilter = createDomainErrorPageFilter({
  TASK_NOT_FOUND: makeRedirectHandler('/tasks/home'),

  USER_NOT_FOUND: makeRedirectHandler('/auth/signin'),

  INVALID_TASK_STATUS: makeRedirectHandler('/tasks/home'),
});
