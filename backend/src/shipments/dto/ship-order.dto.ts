import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ShipOrderDto {
  @IsOptional() @IsString() @MaxLength(64) consignmentNo?: string;
  @IsOptional() @IsString() @MaxLength(128) consignmentName?: string;
  /** Nota del fornitore: viene inoltrata a Dinghuobao come consignmentRemark. */
  @IsOptional() @IsString() @MaxLength(500) remark?: string;
}
