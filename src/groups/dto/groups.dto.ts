import { GroupRole } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
} from 'class-validator';

export class CreateGroupDto {
  @IsNotEmpty()
  @IsString()
  name: string;
}

export class InviteGroupMemberDto {
  @IsNotEmpty()
  @IsEmail()
  email: string;
}

export class KickOutMemberFromGroupDto {
  @IsNotEmpty()
  @IsNumber()
  memberId: number;
}

export class UpdateMemberRoleDto {
  @IsNotEmpty()
  @IsNumber()
  memberId: number;

  @IsNotEmpty()
  @IsEnum(GroupRole)
  newRole: GroupRole;
}
