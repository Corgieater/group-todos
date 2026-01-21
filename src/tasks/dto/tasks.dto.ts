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
  IsNumber,
  Max,
  Min,
  IsInt,
  IsIn,
} from 'class-validator';
import { TaskStatus, TaskStatusValues } from '../types/enum';
import { TaskPriority } from '../types/enum';
import { Transform, Type } from 'class-transformer';
import { AssignmentStatus } from 'src/generated/prisma/client';

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
  @IsString()
  dueDate?: string; // 2026-01-16

  @IsOptional()
  @Transform(({ value }) => {
    // 處理 undefined 情況
    if (value === undefined) return false;

    return [true, 'true', '1', 'on', 'yes'].includes(
      String(value).toLowerCase(),
    );
  })
  @IsBoolean()
  allDay: boolean;

  @IsOptional()
  @IsString()
  dueTime?: string; // 13:30

  @IsOptional()
  @IsString()
  location?: string;
}

export class TaskQueryDto {
  @IsOptional()
  @IsEnum(TaskStatus, { message: 'Status must be OPEN, CLOSED or ARCHIVED' })
  status?: string;

  @IsOptional()
  @IsString()
  scope?: string;

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

export class SubTasksAddDto extends TasksAddDto {
  @IsNotEmpty()
  @Type(() => Number)
  parentTaskId!: number;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title: string;

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

export class AssignTaskDto {
  @IsNotEmpty()
  @IsNumber()
  assigneeId: number;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true) // 處理 Form 送來的字串
  sendUrgentEmail?: boolean;
}
