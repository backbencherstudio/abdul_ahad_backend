import { IsOptional, IsString, IsEmail, IsNumberString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateGarageProfileDto {
  @ApiProperty({ description: 'Garage name', required: false })
  @IsOptional()
  @IsString()
  garage_name?: string;

  @ApiProperty({ description: 'Garage address', required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ description: 'Garage postcode', required: false })
  @IsOptional()
  @IsString()
  zip_code?: string;

  @ApiProperty({ description: 'Email address', required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ description: 'VTS number', required: false })
  @IsOptional()
  @IsString()
  vts_number?: string;

  @ApiProperty({ description: 'Primary contact', required: false })
  @IsOptional()
  @IsString()
  primary_contact?: string;

  @ApiProperty({ description: 'Phone number', required: false })
  @IsOptional()
  @IsString()
  phone_number?: string;
}
