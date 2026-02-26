import { Reflector } from '@nestjs/core';
export enum MemberRoles {
  ADMIN = 'ADMIN',
  OWNER = 'OWNER',
}
export const RequireRoles = Reflector.createDecorator<MemberRoles[]>();
