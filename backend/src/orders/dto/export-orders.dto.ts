import { IsArray, IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { ListOrdersDto } from './list-orders.dto';

/** Export ordini: o gli id selezionati, oppure gli stessi filtri della lista. */
export class ExportOrdersDto extends ListOrdersDto {
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  ids?: number[];
}
