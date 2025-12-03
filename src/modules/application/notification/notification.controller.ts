import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../modules/auth/guards/jwt-auth.guard';
import { Request } from 'express';
import { FetchNotificationDto } from './dto/fetch-notification.dto';

@ApiBearerAuth()
@ApiTags('Notification')
@UseGuards(JwtAuthGuard)
@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @ApiOperation({ summary: 'Get all notifications' })
  @Get()
  async findAll(@Req() req: Request, @Query() query: FetchNotificationDto) {
    try {
      const userId = req.user.userId;
      return await this.notificationService.findAll(userId, query);
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  @ApiOperation({ summary: 'Get unread notification count' })
  @Get('unread-count')
  async getUnreadCount(@Req() req: Request) {
    try {
      const userId = req.user.userId;
      return await this.notificationService.getUnreadCount(userId);
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  @ApiOperation({ summary: 'Mark all notifications as read' })
  @Patch('read-all')
  async markAllAsRead(@Req() req: Request) {
    try {
      const userId = req.user.userId;
      return await this.notificationService.markAllAsRead(userId);
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  @ApiOperation({ summary: 'Mark notification as read' })
  @Patch(':id/read')
  async markAsRead(@Req() req: Request, @Param('id') id: string) {
    try {
      const userId = req.user.userId;
      return await this.notificationService.markAsRead(userId, id);
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }
}
