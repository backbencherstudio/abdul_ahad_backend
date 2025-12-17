import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { UpdateNotificationDto } from './dto/update-notification.dto';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  FetchNotificationDto,
  NotificationFilterType,
} from './dto/fetch-notification.dto';
import { SojebStorage } from 'src/common/lib/Disk/SojebStorage';
import appConfig from 'src/config/app.config';
import { NotificationType } from 'src/common/repository/notification/notification.repository';
import { NotificationGateway } from './notification.gateway';

@Injectable()
export class NotificationService {
  constructor(
    private prisma: PrismaService,
    private notificationGateway: NotificationGateway,
  ) {}

  async addAdditionalData(notification: any) {
    try {
      let entity;
      if (!entity) {
        const order = await this.prisma.order.findFirst({
          where: {
            id: notification?.entity_id,
          },
          select: {
            id: true,
            vehicle: {
              select: {
                id: true,
                registration_number: true,
                make: true,
                model: true,
                color: true,
                fuel_type: true,
                year_of_manufacture: true,
                engine_capacity: true,
                co2_emissions: true,
                mot_expiry_date: true,
              },
            },
          },
        });
        if (order) {
          const { id, ...vehicle } = order?.vehicle;
          entity = {
            ...(order?.id && { order_id: order.id }),
            ...(id && { vehicle_id: id }),
            ...(vehicle && vehicle),
          };
        }
      }
      if (!entity) {
        const vehicle = await this.prisma.vehicle.findUnique({
          where: {
            id: notification.entity_id,
          },
          select: {
            id: true,
            registration_number: true,
            make: true,
            model: true,
            color: true,
            fuel_type: true,
            year_of_manufacture: true,
            engine_capacity: true,
            co2_emissions: true,
            mot_expiry_date: true,
          },
        });
        if (vehicle) {
          const { id, ...rest } = vehicle;
          entity = {
            ...(id && { vehicle_id: id }),
            ...(rest && rest),
          };
        }
      }
      notification['data'] = entity;
    } catch (error) {
      console.log(error);
    }
    return notification;
  }

  async create(createNotificationDto: CreateNotificationDto) {
    // 1. Save to Database
    const notification = await this.prisma.notification.create({
      data: {
        receiver: {
          connect: { id: createNotificationDto.receiver_id },
        },
        sender: createNotificationDto.sender_id
          ? { connect: { id: createNotificationDto.sender_id } }
          : undefined,
        entity_id: createNotificationDto.entity_id,
        notification_event: {
          create: {
            type: createNotificationDto.type,
            text: createNotificationDto.text,
            actions: createNotificationDto.actions as any,
          },
        },
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
    });

    // 2. Add avatar URL if sender exists
    if (notification.sender && notification.sender.avatar) {
      notification.sender['avatar_url'] = SojebStorage.url(
        appConfig().storageUrl.avatar + notification.sender.avatar,
      );
    }

    // 3. Emit via Gateway
    // The gateway handles sending to the specific user via Redis/Socket.io
    await this.notificationGateway.handleNotification({
      userId: createNotificationDto.receiver_id,
      ...(await this.addAdditionalData(notification)),
    });

    return notification;
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
    const data = await Promise.all(
      notifications.map(async (notification) => {
        if (notification.sender && notification.sender.avatar) {
          notification.sender['avatar_url'] = SojebStorage.url(
            appConfig().storageUrl.avatar + notification.sender.avatar,
          );
        }

        return this.addAdditionalData(notification);
      }),
    );

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
