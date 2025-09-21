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
} from 'class-validator';
import { Status } from '@prisma/client';
import { TaskPriority } from '../types/enum';
import { Transform } from 'class-transformer';

function toBool(val: any): boolean {
  if (typeof val === 'boolean') return val;
  const s = String(val ?? '')
    .trim()
    .toLowerCase();
  if (['true', '1', 'on', 'yes', 'y'].includes(s)) return true;
  return false; // 其他都算 false（包含 '', '0', 'off', 'no'）
}

export class TasksAddDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsOptional()
  @IsEnum(Status)
  status?: Status;

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

  // allDay：支援陣列；預設 true（你表單預設勾選）
  @Transform(({ value }) =>
    Array.isArray(value) ? value.map(toBool).some(Boolean) : toBool(value),
  )
  @IsBoolean()
  allDay: boolean = false; // ← 和 UI 對齊

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

export class UpdateTaskStatusDto {
  @IsNotEmpty()
  @IsEnum(Status)
  @Transform(({ value }) => String(value).toUpperCase())
  status: Status;
}

export class ListTasksQueryDto {
  @IsEnum(Status)
  status: Status;
}
