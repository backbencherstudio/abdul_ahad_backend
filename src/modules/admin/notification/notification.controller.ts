import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';
import { NotificationService } from './notification.service';
import { CreateBulkNotificationDto } from './dto/create-notification.dto';
@ApiTags('Admin Notifications')
@Controller('admin/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post('bulk')
  async createBulkNotification(@Body() body: CreateBulkNotificationDto) {
    return this.notificationService.createBulkNotification(body);
  }

  @ApiOperation({
    summary: 'Get current admin notifications',
    description:
      'Retrieve all notifications for the currently logged-in admin user',
  })
  @ApiResponse({
    status: 200,
    description: 'Notifications retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string', example: 'MIGRATION_FAILED' },
          message: {
            type: 'string',
            example:
              'Migration job failed for plan "Premium Plan". 5 out of 50 subscriptions could not be migrated.',
          },
          metadata: { type: 'object' },
          entity_id: { type: 'string' },
          is_read: { type: 'boolean' },
          read_at: { type: 'string', format: 'date-time' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  @ApiQuery({
    name: 'unread_only',
    required: false,
    type: Boolean,
    description: 'Filter to show only unread notifications',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    type: String,
    description: 'Filter by notification type',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of notifications to return (default: 50)',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Offset for pagination (default: 0)',
  })
  @Get()
  async getMyNotifications(
    @Req() req,
    @Query('unread_only') unreadOnly?: string,
    @Query('type') type?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ) {
    const adminId = req.user.userId;

    return this.notificationService.getAdminNotifications(adminId, {
      unreadOnly: unreadOnly === 'true',
      type,
      limit,
      offset,
    });
  }

  @ApiOperation({
    summary: 'Get unread notification count',
    description: 'Get the count of unread notifications for current admin',
  })
  @ApiResponse({
    status: 200,
    description: 'Unread count retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        count: { type: 'number', example: 5 },
      },
    },
  })
  @Get('unread/count')
  async getUnreadCount(@Req() req) {
    const adminId = req.user.id;
    const count = await this.notificationService.getUnreadCount(adminId);
    return { count };
  }

  @ApiOperation({
    summary: 'Mark notification as read',
    description: 'Mark a specific notification as read',
  })
  @ApiResponse({
    status: 200,
    description: 'Notification marked as read successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Notification not found',
  })
  @ApiParam({ name: 'id', description: 'Notification ID' })
  @Put(':id/read')
  async markAsRead(@Param('id') id: string, @Req() req) {
    const adminId = req.user.id;
    return this.notificationService.markAsRead(id, adminId);
  }

  @ApiOperation({
    summary: 'Mark all notifications as read',
    description: 'Mark all unread notifications as read for current admin',
  })
  @ApiResponse({
    status: 200,
    description: 'All notifications marked as read successfully',
  })
  @Put('read-all')
  async markAllAsRead(@Req() req) {
    const adminId = req.user.id;
    return this.notificationService.markAllAsRead(adminId);
  }

  @ApiOperation({
    summary: 'Delete all notifications',
    description: 'Delete all notifications for current admin',
  })
  @ApiResponse({
    status: 200,
    description: 'All notifications deleted successfully',
  })
  @Delete('all')
  async deleteAllNotifications(@Req() req) {
    const adminId = req.user.id;
    return this.notificationService.deleteAllNotifications(adminId);
  }

  @ApiOperation({
    summary: 'Delete notification by ID',
    description: 'Soft delete a notification by its ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Notification deleted successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Notification not found',
  })
  @ApiParam({ name: 'id', description: 'Notification ID' })
  @Delete(':id')
  async deleteNotificationById(@Param('id') id: string, @Req() req) {
    const adminId = req.user.id;
    return this.notificationService.deleteNotificationById(id, adminId);
  }
}
