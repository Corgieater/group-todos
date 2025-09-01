import {
  IsISO8601,
  IsNotEmpty,
  IsString,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { Status } from '@prisma/client';
import { TaskPriority } from '../types/enum';

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
  @IsISO8601({ strict: true })
  dueAt?: string;

  @IsOptional()
  @IsString()
  location?: string;
}
