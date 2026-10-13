import { IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class ReportQueryDto {
  /** 意大利本地日期（yyyy-MM-dd） */
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  @IsOptional() @Type(() => Number) @IsInt() supplierId?: number;
  /** 分组维度：product（默认） | supplier | order */
  @IsOptional() @IsString() groupBy?: 'product' | 'supplier' | 'order';
  /** Colonne richieste per tabella/esportazione (chiavi separate da virgola). */
  @IsOptional() @IsString() fields?: string;
}
