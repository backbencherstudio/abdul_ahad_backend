import { ApiProperty } from '@nestjs/swagger';

export class GarageDto {
  @ApiProperty({
    description: 'Garage ID',
    example: 'clx1234567890abcdef',
  })
  id: string;

  @ApiProperty({
    description: 'Garage name',
    example: 'QuickFix Auto',
  })
  garage_name: string;

  @ApiProperty({
    description: 'Garage address',
    example: '123 Oxford Road, Manchester',
  })
  address: string;

  @ApiProperty({
    description: 'Garage postcode',
    example: 'M1 1AA',
  })
  postcode: string;

  @ApiProperty({
    description: 'VTS Number',
    example: 'VTS123456',
  })
  vts_number: string;

  @ApiProperty({
    description: 'Primary contact person',
    example: 'John Smith',
  })
  primary_contact: string;

  @ApiProperty({
    description: 'Garage phone number',
    example: '+44123456789',
  })
  phone_number: string;

  @ApiProperty({
    description: 'Distance from search postcode in miles',
    example: 2.5,
  })
  distance_miles?: number;
}

export class VehicleInfoDto {
  @ApiProperty({
    description: 'Vehicle registration number',
    example: 'AB12 CDE',
  })
  registration_number: string;

  @ApiProperty({
    description: 'Vehicle make',
    example: 'FORD',
  })
  make: string;

  @ApiProperty({
    description: 'Vehicle model',
    example: 'FOCUS',
  })
  model: string;

  @ApiProperty({
    description: 'Vehicle color',
    example: 'Silver',
  })
  color: string;

  @ApiProperty({
    description: 'Fuel type',
    example: 'Petrol',
  })
  fuel_type: string;

  @ApiProperty({
    description: 'MOT expiry date',
    example: '2025-01-15',
  })
  mot_expiry_date: string;

  @ApiProperty({
    description: "Whether vehicle exists in user's account",
    example: true,
  })
  exists_in_account: boolean;

  // ✅ ADD THIS FIELD
  @ApiProperty({
    description: 'Vehicle ID in database (for booking)',
    example: 'clx1234567890abcdef',
  })
  vehicle_id: string;
}

export class GarageSearchResponseDto {
  @ApiProperty({
    description: 'Vehicle information from DVLA',
    type: VehicleInfoDto,
  })
  vehicle: VehicleInfoDto;

  @ApiProperty({
    description: 'List of available garages',
    type: [GarageDto],
  })
  garages: GarageDto[];

  @ApiProperty({
    description: 'Total number of garages found',
    example: 5,
  })
  total_count: number;

  @ApiProperty({
    description: 'Search postcode used',
    example: 'M1 1AA',
  })
  search_postcode: string;
}
