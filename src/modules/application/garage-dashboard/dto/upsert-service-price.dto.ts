import {
  IsOptional,
  IsString,
  IsNumber,
  IsArray,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MotServiceDto {
  @ApiProperty({ example: 'MOT Test' })
  @IsString()
  name: string;

  @ApiProperty({ example: 54.85 })
  @IsNumber()
  @Min(0, { message: 'Price must be non-negative' })
  price: number;
}

export class RetestServiceDto {
  @ApiProperty({ example: 'MOT Retest' })
  @IsString()
  name: string;

  @ApiProperty({ example: 20.0 })
  @IsNumber()
  @Min(0, { message: 'Price must be non-negative' })
  price: number;
}

export class AdditionalServiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: 'Tyre Change' })
  @IsString()
  name: string;

  // No price field for additional services
}

export class UpsertServicePriceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => MotServiceDto)
  mot?: MotServiceDto;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => RetestServiceDto)
  retest?: RetestServiceDto;

  @ApiPropertyOptional({ type: [AdditionalServiceDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdditionalServiceDto)
  additionals?: AdditionalServiceDto[];
}
