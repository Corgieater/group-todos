import { HttpStatus } from '@nestjs/common';
import { createDomainErrorPageFilter } from './factory/create-domain-error-page-filter';
import { makeRedirectHandler } from '../types/domain-error-page.types';
import { globalDomainErrorMap } from './common-domain-error-map';

export const TasksPageFilter = createDomainErrorPageFilter({
  ...globalDomainErrorMap,
  TASK_NOT_FOUND: makeRedirectHandler('/tasks/home', {
    semanticStatus: HttpStatus.NOT_FOUND,
    msg: () => 'Task not found',
  }),

  INVALID_TASK_STATUS: makeRedirectHandler('/tasks/home', {
    semanticStatus: HttpStatus.BAD_REQUEST,
    msg: () => 'Invalid task status',
  }),

  TASK_FORBIDDEN: makeRedirectHandler('/tasks/home', {
    semanticStatus: HttpStatus.FORBIDDEN,
    msg: () => 'You are not allowed to perform this action on the task',
  }),
});
