import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export enum Order {
  ASC = 'asc',
  DESC = 'desc',
}

export class PageOptionsDto {
  @IsEnum(Order)
  @IsOptional()
  readonly order?: Order = Order.DESC;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  readonly page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  readonly limit?: number = 10;

  @IsString()
  @IsOptional()
  readonly q?: string;

  // 這裡要處理 undefined 的情況，確保計算不會出錯
  get skip(): number {
    return ((this.page ?? 1) - 1) * (this.limit ?? 10);
  }
}
