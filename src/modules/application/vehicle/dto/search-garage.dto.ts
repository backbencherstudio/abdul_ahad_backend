import {
  IsString,
  IsNotEmpty,
  Matches,
  IsOptional,
  IsNumber,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export enum GarageSortBy {
  DISTANCE = 'DISTANCE',
  PRICE_LOW_TO_HIGH = 'PRICE_LOW_TO_HIGH',
  PRICE_HIGH_TO_LOW = 'PRICE_HIGH_TO_LOW',
}

export class SearchGarageDto {
  @ApiProperty({
    description: 'Vehicle registration number',
    example: 'AB12 CDE',
    pattern: '^[A-Z0-9]{2,7}$',
  })
  @IsString()
  @IsNotEmpty({ message: 'Registration number is required' })
  @Matches(/^[A-Z0-9]{2,7}$/i, {
    message:
      'Registration number must be 2-7 characters, letters and numbers only',
  })
  registration_number: string;

  @ApiProperty({
    description: 'UK postcode for garage search',
    example: 'M1 1AA',
    pattern: '^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$',
  })
  @IsString()
  @IsNotEmpty({ message: 'Postcode is required' })
  @Matches(/^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i, {
    message: 'Please enter a valid UK postcode',
  })
  postcode: string;

  @ApiProperty({
    description: 'Limit of garages to return',
    example: 10,
    default: 10,
  })
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : 10))
  @IsNumber()
  limit?: number;

  @ApiProperty({
    description: 'Page number for pagination',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : 1))
  @IsNumber()
  page?: number;

  @ApiProperty({
    description: 'Sort by field',
    enum: GarageSortBy,
    example: GarageSortBy.DISTANCE,
    default: GarageSortBy.DISTANCE,
    required: false,
  })
  @IsOptional()
  sort_by?: GarageSortBy = GarageSortBy.DISTANCE;
}
