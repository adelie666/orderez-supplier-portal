import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString() @MaxLength(128) oldPassword: string;
  @IsString() @MinLength(8) @MaxLength(128) newPassword: string;
}
