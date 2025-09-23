import { ApiProperty } from '@nestjs/swagger';

export class SubscriptionPlanResponseDto {
  @ApiProperty({ description: 'Plan ID' })
  id: string;

  @ApiProperty({ description: 'Plan name' })
  name: string;

  @ApiProperty({ description: 'Plan description', required: false })
  description?: string;

  @ApiProperty({ description: 'Price in pence' })
  price_pence: number;

  @ApiProperty({ description: 'Formatted price string' })
  price_formatted: string;

  @ApiProperty({ description: 'Currency code' })
  currency: string;

  @ApiProperty({ description: 'Maximum bookings per month' })
  max_bookings_per_month: number;

  @ApiProperty({ description: 'Maximum vehicles allowed' })
  max_vehicles: number;

  @ApiProperty({ description: 'Includes priority support' })
  priority_support: boolean;

  @ApiProperty({ description: 'Includes advanced analytics' })
  advanced_analytics: boolean;

  @ApiProperty({ description: 'Includes custom branding' })
  custom_branding: boolean;

  @ApiProperty({ description: 'List of plan features' })
  features: string[];
}

export class SubscriptionPlansResponseDto {
  @ApiProperty({
    description: 'List of available plans',
    type: [SubscriptionPlanResponseDto],
  })
  plans: SubscriptionPlanResponseDto[];

  @ApiProperty({ description: 'Pagination information' })
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
