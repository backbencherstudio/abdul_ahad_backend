import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum NotificationFilterType {
  ALL = 'ALL',
  UNREAD = 'UNREAD',
}

export class FetchNotificationDto {
  @ApiPropertyOptional({
    enum: NotificationFilterType,
    default: NotificationFilterType.ALL,
  })
  @IsOptional()
  @IsEnum(NotificationFilterType)
  type?: NotificationFilterType = NotificationFilterType.ALL;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 10;
}
