import {
  IsString,
  IsDateString,
  IsOptional,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum ModificationType {
  MANUAL_BLOCK = 'MANUAL_BLOCK',
  BOOKED = 'BOOKED',
  TIME_MODIFIED = 'TIME_MODIFIED',
}

export class SlotModificationDto {
  @ApiProperty({ description: 'Start date for modification (YYYY-MM-DD)' })
  @IsDateString()
  start_date: string;

  @ApiProperty({ description: 'End date for modification (YYYY-MM-DD)' })
  @IsDateString()
  end_date: string;

  @ApiProperty({ description: 'Start time (HH:mm)', required: false })
  @IsString()
  @IsOptional()
  start_time?: string;

  @ApiProperty({ description: 'End time (HH:mm)', required: false })
  @IsString()
  @IsOptional()
  end_time?: string;

  @ApiProperty({ description: 'Action to perform', enum: ['BLOCK', 'UNBLOCK'] })
  @IsString()
  @IsEnum(['BLOCK', 'UNBLOCK'])
  action: 'BLOCK' | 'UNBLOCK';

  @ApiProperty({ description: 'Reason for modification', required: false })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiProperty({
    description: 'Replace existing slots',
    required: false,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  replace_existing?: boolean;
}

// ✅ FIXED: Enhanced interface to handle both success and failure cases
export interface ModificationResult {
  success: boolean;
  modifications?: Array<{
    slot_id: string;
    status: 'CREATED' | 'UPDATED' | 'SKIPPED_BOOKED';
    details?: {
      original_time?: {
        start: string;
        end: string;
      };
      new_time?: {
        start: string;
        end: string;
      };
    };
  }>;
  message: string;
  warning?: string;
  affected_slots?: Array<{
    id?: string; // Optional - only for database slots
    time: string;
    status: 'AVAILABLE' | 'BOOKED';
    source: 'DATABASE' | 'TEMPLATE';
  }>;
  requires_confirmation?: boolean;
}
