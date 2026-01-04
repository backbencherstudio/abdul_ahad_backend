import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateMotReminderSettingsDto {
  @ApiProperty({
    description: 'List of days before expiry to send reminders',
    example: [15, 7, 1],
    type: [Number],
  })
  @IsArray()
  @IsInt({ each: true })
  reminderPeriods: number[];

  @ApiProperty({
    description: 'Whether automatic MOT reminders are enabled',
    example: true,
  })
  @IsBoolean()
  autoReminder: boolean;

  @ApiProperty({
    description: 'Custom message for MOT reminders',
    example:
      'Your vehicle {make} {model} ({registration}) has an MOT expiring in {days} days.',
    required: false,
  })
  @IsString()
  @IsOptional()
  reminderMessage?: string;
}
