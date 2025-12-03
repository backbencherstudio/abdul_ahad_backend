import { Injectable } from '@nestjs/common';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  FetchNotificationDto,
  NotificationFilterType,
} from './dto/fetch-notification.dto';
import { SojebStorage } from 'src/common/lib/Disk/SojebStorage';
import appConfig from 'src/config/app.config';

@Injectable()
export class NotificationService {
  constructor(private prisma: PrismaService) {}

  create(createNotificationDto: CreateNotificationDto) {
    return 'This action adds a new notification';
  }

  async findAll(userId: string, query?: FetchNotificationDto) {
    const { page = 1, limit = 10, type = NotificationFilterType.ALL } = query;
    const skip = (page - 1) * limit;

    const whereCondition: any = {
      receiver_id: userId,
    };

    if (type === NotificationFilterType.UNREAD) {
      whereCondition.read_at = null;
    }

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: whereCondition,
        skip,
        take: limit,
        orderBy: {
          created_at: 'desc',
        },
        include: {
          notification_event: true,
          sender: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
        },
      }),
      this.prisma.notification.count({
        where: whereCondition,
      }),
    ]);

    // Add avatar URL
    const data = notifications.map((notification) => {
      if (notification.sender && notification.sender.avatar) {
        notification.sender['avatar_url'] = SojebStorage.url(
          appConfig().storageUrl.avatar + notification.sender.avatar,
        );
      }
      return notification;
    });

    return {
      success: true,
      message:
        data.length > 0
          ? 'Notifications fetched successfully'
          : 'No notifications found',
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUnreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: {
        receiver_id: userId,
        read_at: null,
      },
    });
    return {
      success: true,
      message: count
        ? 'Unread count fetched successfully'
        : 'No unread notifications',
      count,
    };
  }

  async markAsRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: {
        id,
        receiver_id: userId,
        read_at: null,
      },
      data: {
        read_at: new Date(),
      },
    });
    return { success: true, message: 'Notification marked as read' };
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: {
        receiver_id: userId,
        read_at: null,
      },
      data: {
        read_at: new Date(),
      },
    });
    return { success: true, message: 'All notifications marked as read' };
  }

  findOne(id: number) {
    return `This action returns a #${id} notification`;
  }

  update(id: number, updateNotificationDto: UpdateNotificationDto) {
    return `This action updates a #${id} notification`;
  }

  remove(id: number) {
    return `This action removes a #${id} notification`;
  }
}
