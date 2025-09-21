import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsString,
  IsArray,
  IsEnum,
} from 'class-validator';
import { Role } from '../../../../common/guard/role/role.enum';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  phone_number?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsEnum(Role)
  type: Role;

  @IsOptional()
  @IsString()
  garage_name?: string;

  @IsOptional()
  @IsString()
  vts_number?: string;

  @IsOptional()
  @IsString()
  primary_contact?: string;

  // ✅ NEW: Add role_ids field
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  role_ids?: string[];
}
