import { HttpStatus } from '@nestjs/common';
import { createDomainErrorPageFilter } from './factory/create-domain-error-page-filter';
import { makeRedirectHandler } from '../types/domain-error-page.types';

export const TasksPageFilter = createDomainErrorPageFilter({
  TASK_NOT_FOUND: makeRedirectHandler('/tasks/home', 'Task not found.', {
    status: HttpStatus.NOT_FOUND,
  }),

  USER_NOT_FOUND: makeRedirectHandler('/auth/signin', 'Invalid credential', {
    status: HttpStatus.FORBIDDEN,
  }),

  INVALID_TASK_STATUS: makeRedirectHandler(
    '/tasks/home',
    'Invalid task status',
    { status: HttpStatus.BAD_REQUEST },
  ),
});
