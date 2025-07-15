import { IsOptional, IsString, IsNumber, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ServiceType } from '@prisma/client';

export class UpdateServiceDto {
  @ApiProperty({ description: 'Service name', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: 'Service price', required: false })
  @IsOptional()
  @IsNumber()
  price?: number;

  @ApiProperty({
    description: 'Service type',
    enum: ServiceType,
    required: false,
  })
  @IsOptional()
  @IsEnum(ServiceType)
  type?: ServiceType;
}
