import { IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAccountDto {
  @IsString() @MinLength(3) @MaxLength(64) username: string;
  @IsString() @MinLength(8) @MaxLength(128) password: string;
  /** 供应商角色必填（文档 §8.2 /accounts：下拉选供应商） */
  @IsOptional() @Type(() => Number) @IsInt() supplierId?: number;
}

export class ResetPasswordDto {
  @IsString() @MinLength(8) @MaxLength(128) password: string;
}

export class UpdateAccountDto {
  @IsOptional() @IsInt() status?: number;
  @IsOptional() @Type(() => Number) @IsInt() supplierId?: number;
}
