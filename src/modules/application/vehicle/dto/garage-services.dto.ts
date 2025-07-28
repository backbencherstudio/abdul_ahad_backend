import { ApiProperty } from '@nestjs/swagger';

export class BookableServiceDto {
  @ApiProperty({
    description: 'Service ID',
    example: 'clx1234567890abcdef',
  })
  id: string;

  @ApiProperty({
    description: 'Service name',
    example: 'MOT Test',
  })
  name: string;

  @ApiProperty({
    description: 'Service type',
    enum: ['MOT', 'RETEST'],
    example: 'MOT',
  })
  type: 'MOT' | 'RETEST';

  @ApiProperty({
    description: 'Service price in GBP',
    example: 54.85,
  })
  price: number;
}

export class AdditionalServiceDto {
  @ApiProperty({
    description: 'Service ID',
    example: 'clx1234567890abcdef',
  })
  id: string;

  @ApiProperty({
    description: 'Service name',
    example: 'Tyre Change',
  })
  name: string;

  @ApiProperty({
    description: 'Service type (always ADDITIONAL)',
    example: 'ADDITIONAL',
  })
  type: 'ADDITIONAL';
}

export class GarageServicesResponseDto {
  @ApiProperty({
    description: 'Bookable services (MOT and Retest)',
    type: [BookableServiceDto],
  })
  services: BookableServiceDto[];

  @ApiProperty({
    description: 'Additional services (showcase only)',
    type: [AdditionalServiceDto],
  })
  additionals: AdditionalServiceDto[];
}
