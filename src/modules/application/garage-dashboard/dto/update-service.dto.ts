import { IsOptional, IsString, IsNumber, IsEnum, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceType } from '@prisma/client';

export class UpdateServiceDto {
  @ApiPropertyOptional({ example: 'MOT Test' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 54.85 })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'Price must be non-negative' })
  price?: number;

  @ApiPropertyOptional({ enum: ServiceType, example: ServiceType.MOT })
  @IsOptional()
  @IsEnum(ServiceType)
  type?: ServiceType;
}
