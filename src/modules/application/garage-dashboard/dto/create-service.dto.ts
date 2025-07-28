import { IsString, IsNumber, IsEnum, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceType } from '@prisma/client';

export class CreateServiceDto {
  @ApiProperty({ example: 'MOT Test' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 54.85 })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Price must be non-negative' })
  price?: number;

  @ApiProperty({ enum: ServiceType, example: ServiceType.MOT })
  @IsEnum(ServiceType)
  type: ServiceType;
}
