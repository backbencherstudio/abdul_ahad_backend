import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class BanUserDto {
  @ApiProperty({
    description: 'Reason for banning the user (optional)',
    example: 'Violation of terms of service',
    required: false,
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
