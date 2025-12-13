import {
  IsNotEmpty,
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
  Matches,
  IsMilitaryTime,
  ValidateIf,
  IsDefined,
  IsEmpty,
  MaxLength,
} from 'class-validator';
import { TaskStatus, TaskStatusValues } from '../types/enum';
import { TaskPriority } from '../types/enum';
import { Transform, Type } from 'class-transformer';
import { AssignmentStatus } from 'src/generated/prisma/client';
import { OmitType } from '@nestjs/mapped-types';

function toBool(val: any): boolean {
  if (typeof val === 'boolean') return val;
  const s = String(val ?? '')
    .trim()
    .toLowerCase();
  if (['true', '1', 'on', 'yes', 'y'].includes(s)) return true;
  return false; // 其他都算 false（包含 '', '0', 'off', 'no'）
}

const TRUE_LIKE = new Set(['1', 'true', 'on', 'yes', 'y', 't']);
function isTrueLike(v: unknown): boolean {
  const s = String(v).trim().toLowerCase();
  return TRUE_LIKE.has(s);
}

export class TasksAddDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @Transform(({ value }) =>
    value === '' || value == null ? undefined : String(value).trim(),
  )
  dueDate?: string;

  // check if this can be used
  @Type(() => String)
  @Transform(
    ({ value }) => {
      if (Array.isArray(value)) {
        // hidden=0 + checkbox=1 → ['0','1'] → true
        return value.some(isTrueLike);
      }
      // 單值 '0' → false；'1' → true；undefined/null → false
      if (value == null) return false;
      return isTrueLike(value);
    },
    { toClassOnly: true },
  )
  @IsBoolean()
  allDay!: boolean;

  // 規則 1：當 allDay=false，dueTime 必填且要 HH:mm
  @ValidateIf((o) => o.allDay === false)
  @IsDefined({ message: 'dueTime is required when allDay is false' })
  @IsMilitaryTime()

  // 規則 2：當 allDay=true，dueTime 必須為空（用 @IsEmpty 表達，不用 class-level）
  @ValidateIf((o) => o.allDay === true)
  @IsEmpty({ message: 'dueTime must be empty when allDay is true' })

  // 防呆：若 allDay=true，後端直接清掉 dueTime
  @Transform(({ value, obj }) => {
    const a = Array.isArray(obj?.allDay) ? obj.allDay : [obj?.allDay];
    const allDayTrue = a.map(toBool).some(Boolean);
    if (allDayTrue) return undefined;
    return value === '' || value == null ? undefined : String(value).trim();
  })
  dueTime?: string;

  @IsOptional()
  @IsString()
  location?: string;
}

export class SubTasksAddDto extends TasksAddDto {
  @IsNotEmpty()
  @Type(() => Number)
  parentTaskId!: number;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @Transform(({ value }) =>
    value === '' || value == null ? undefined : String(value).trim(),
  )
  dueDate?: string;

  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value) ? value.map(toBool).some(Boolean) : toBool(value),
  )
  @IsBoolean()
  allDay?: boolean;

  @IsOptional()
  @IsMilitaryTime()
  @Transform(({ value, obj }) => {
    const a = Array.isArray(obj?.allDay) ? obj.allDay : [obj?.allDay];
    const allDayTrue = a.map(toBool).some(Boolean);
    if (allDayTrue) return undefined;
    return value === '' || value == null ? undefined : String(value).trim();
  })
  dueTime?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value == undefined ? 3 : Number(value),
  )
  @IsEnum(TaskPriority)
  priority?: TaskPriority;
}

export class closeTaskDto {
  @IsNotEmpty()
  @IsEnum(TaskStatus, {
    message: `status must be one of: ${TaskStatusValues.join(', ')}`,
  })
  @Transform(
    ({ value }) => (value == null ? value : String(value).trim().toUpperCase()),
    { toClassOnly: true },
  )
  status!: TaskStatus;
}

export class ListTasksQueryDto {
  @IsEnum(TaskStatus)
  status: TaskStatus;
}

export class UpdateAssigneeStatusDto {
  @IsEnum(AssignmentStatus)
  status!: AssignmentStatus; // PENDING/ACCEPTED/DECLINED/COMPLETED

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string; // 例如 Declined 的理由，可選
}
