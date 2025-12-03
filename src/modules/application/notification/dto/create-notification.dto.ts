import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { NotificationType } from 'src/common/repository/notification/notification.repository';

/**
 * Type alias for notification type values
 */
export type NotificationTypeValue = `${NotificationType}`;

export class CreateNotificationDto {
  @IsNotEmpty()
  @IsString()
  receiver_id: string;

  @IsNotEmpty()
  @IsEnum(NotificationType)
  type: NotificationType;

  @IsNotEmpty()
  @IsString()
  text: string;

  @IsOptional()
  @IsString()
  entity_id?: string;

  @IsOptional()
  @IsString()
  sender_id?: string;

  @IsOptional()
  actions?: any[];
}
