import { IsArray, IsBoolean, IsInt } from 'class-validator';
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
}
