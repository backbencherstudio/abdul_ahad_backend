import { IsString, IsNumber, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ServiceType } from '@prisma/client';

export class CreateServiceDto {
  @ApiProperty({ description: 'Service name' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Service price' })
  @IsNumber()
  price: number;

  @ApiProperty({ description: 'Service type', enum: ServiceType })
  @IsEnum(ServiceType)
  type: ServiceType;
}
