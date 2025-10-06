import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  MinLength,
  IsEmail,
  IsString,
  ValidateIf,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { Role } from 'src/common/guard/role/role.enum';

export class CreateUserDto {
  @IsNotEmpty()
  @IsEnum(['DRIVER', 'GARAGE'], { message: 'type must be DRIVER or GARAGE' })
  @ApiProperty({
    description:
      'User type: DRIVER or GARAGE only (Admin users must be created by administrators)',
    enum: ['DRIVER', 'GARAGE'],
    example: 'DRIVER',
  })
  type: Role;

  // Driver fields
  @ValidateIf((o) => o.type === Role.DRIVER)
  @IsNotEmpty({ message: 'Name is required for drivers' })
  @IsString()
  @ApiProperty({ description: 'Driver full name (required for DRIVER type)' })
  name?: string;

  // Garage fields
  @ValidateIf((o) => o.type === Role.GARAGE)
  @IsNotEmpty({ message: 'Garage name is required for garages' })
  @IsString()
  @ApiProperty({ description: 'Name of the garage (required for GARAGE type)' })
  garage_name?: string;

  @ValidateIf((o) => o.type === Role.GARAGE)
  @IsNotEmpty({ message: 'VTS Number is required for garages' })
  @IsString()
  @ApiProperty({ description: 'VTS Number (required for GARAGE type)' })
  vts_number?: string;

  @ValidateIf((o) => o.type === Role.GARAGE)
  @IsNotEmpty({ message: 'Primary contact is required for garages' })
  @IsString()
  @ApiProperty({
    description: 'Primary contact person (required for GARAGE type)',
  })
  primary_contact?: string;

  // Common fields
  @IsNotEmpty()
  @IsEmail()
  @ApiProperty({ description: 'Email address' })
  email: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({ description: 'Phone number' })
  phone_number: string;

  @IsNotEmpty()
  @MinLength(8, { message: 'Password should be minimum 8 characters' })
  @ApiProperty({ description: 'Password (minimum 8 characters)' })
  password: string;

  @IsOptional()
  @ApiProperty({
    description: 'first name',
    example: 'sadman',
  })
  first_name?: string;

  @IsOptional()
  @ApiProperty({
    description: 'last name',
    example: 'sakib',
  })
  last_name?: string;
}
