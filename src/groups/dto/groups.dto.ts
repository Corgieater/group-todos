import { GroupRole } from 'src/generated/prisma/client';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateGroupDto {
  @IsNotEmpty()
  @IsString()
  name: string;
}

export class UpdateGroupDto extends CreateGroupDto {}

export class GroupPageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  order?: 'ASC' | 'DESC';
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
