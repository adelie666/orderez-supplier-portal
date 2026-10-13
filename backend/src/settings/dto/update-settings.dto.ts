import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IsIn } from 'class-validator';
import { SUPPLIER_FIELD_KEYS } from '../../common/supplier-match.util';

/** 订货宝 ERP 集成配置（唯一一处凭证） */
export class UpdateSettingsDto {
  @IsOptional() @IsString() @MaxLength(255) baseUrl?: string;
  @IsOptional() @IsString() @MaxLength(255) serialNumber?: string;
  @IsOptional() @IsString() @MaxLength(255) password?: string;
  /** Vuoto = nessun campo usato come fornitore. */
  @IsOptional() @IsString() @IsIn(['', ...SUPPLIER_FIELD_KEYS]) supplierField?: string;
}
