import { IsString, IsNumber, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ServiceType } from '@prisma/client';

export class CreateServiceDto {
  @ApiProperty({ example: 'MOT Test' })
  @IsString()
  name: string;

  @ApiProperty({ example: 54.85 })
  @IsNumber()
  price: number;

  @ApiProperty({ enum: ServiceType, example: ServiceType.MOT })
  @IsEnum(ServiceType)
  type: ServiceType;
}
