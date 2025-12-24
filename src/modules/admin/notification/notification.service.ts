import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateBulkNotificationDto } from './dto/create-notification.dto';
import { NotificationGateway } from 'src/modules/application/notification/notification.gateway';
import { MailService } from 'src/mail/mail.service';

export interface CreateAdminNotificationDto {
  type: string; // e.g., 'MIGRATION_FAILED', 'PAYMENT_ERROR', 'SYSTEM_ALERT'
  title: string; // Short semantic title
  message: string; // Detailed semantic message
  metadata?: any; // Additional context (job_id, plan_id, etc.)
  entityId?: string; // Related entity ID
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationGateway: NotificationGateway,
    private readonly mailService: MailService,
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
      // console.log(error?.message);
    }
    return notification;
  }

  async createBulkNotification(dto: CreateBulkNotificationDto) {
    try {
      // console.log(dto);
      await Promise.all(
        dto.receivers.map(async ({ entity_id, receiver_id }) => {
          // 1. Fetch user for email
          const user = await this.prisma.user.findUnique({
            where: { id: receiver_id },
            select: { email: true, name: true },
          });

          // 2. Create database notification
          const notification = await this.prisma.notification.create({
            data: {
              status: 1,
              is_action_taken: false,

              receiver: {
                connect: { id: receiver_id },
              },
              ...(entity_id && { entity_id: entity_id }),
              notification_event: {
                create: {
                  type: 'reminder',
                  text: dto.message,
                  status: 1,
                },
              },
            },
            select: {
              id: true,
              entity_id: true,
              receiver_id: true,
              read_at: true,
              created_at: true,
              is_action_taken: true,
              sender_id: true,
              status: true,
              notification_event: {
                select: {
                  type: true,
                  text: true,
                  actions: true,
                  status: true,
                },
              },
            },
          });

          // 3. Emit via Gateway
          this.notificationGateway.sendNotification({
            userId: receiver_id,
            ...(await this.addAdditionalData(notification)),
          });

          // 4. Send Email Alert
          if (user?.email) {
            await this.mailService.sendNotificationEmail({
              to: user.email,
              user_name: user.name || 'User',
              message: dto.message,
            });
          }
        }),
      );
      // console.log('Notification sent successfully');
      return {
        success: true,
        message: 'Notification sent successfully',
      };
    } catch (error) {
      this.logger.error('Failed to send admin notification:', error);
      throw error;
    }
  }

  /**
   * Send notification to all admin users
   */
  async sendToAllAdmins(dto: CreateAdminNotificationDto) {
    try {
      // Get all active admin users
      const admins = await this.prisma.user.findMany({
        where: {
          type: 'ADMIN',
          status: 1, // Active only
        },
        select: { id: true, email: true, name: true },
      });

      if (admins.length === 0) {
        this.logger.warn('No admin users found to send notification');
        return { success: false, sent_to: 0 };
      }

      // Create notification event
      const notificationEvent = await this.prisma.notificationEvent.create({
        data: {
          type: dto.type,
          text: dto.message,
          actions: dto.metadata || {},
          status: 1,
        },
        select: {
          id: true,
          type: true,
          text: true,
          actions: true,
          status: true,
        },
      });

      // Create notifications for all admins
      const notifications = admins.map((admin) => ({
        receiver_id: admin.id,
        notification_event_id: notificationEvent.id,
        entity_id: dto.entityId,
        status: 1,
        is_action_taken: false,
      }));

      await this.prisma.notification.createMany({
        data: notifications,
      });

      // Fetch the created notifications to send via gateway
      const createdNotifications = await this.prisma.notification.findMany({
        where: {
          notification_event_id: notificationEvent.id,
        },
        select: {
          id: true,
          entity_id: true,
          receiver_id: true,
          read_at: true,
          created_at: true,
          is_action_taken: true,
          sender_id: true,
          status: true,
          notification_event: {
            select: {
              type: true,
              text: true,
              actions: true,
              status: true,
            },
          },
        },
      });

      createdNotifications.forEach((notification) => {
        this.notificationGateway.sendNotification({
          userId: notification.receiver_id,
          ...notification,
        });
      });

      this.logger.log(
        `Notification sent to ${admins.length} admin(s): ${dto.title}`,
      );

      return {
        success: true,
        sent_to: admins.length,
        notification_event_id: notificationEvent.id,
      };
    } catch (error) {
      this.logger.error('Failed to send admin notification:', error);
      throw error;
    }
  }

  /**
   * Send notification to specific admin
   */
  async sendToAdmin(adminId: string, dto: CreateAdminNotificationDto) {
    try {
      // Create notification event
      const notificationEvent = await this.prisma.notificationEvent.create({
        data: {
          type: dto.type,
          text: dto.message,
          actions: dto.metadata || {},
          status: 1,
        },
      });

      // Create notification for specific admin
      const notification = await this.prisma.notification.create({
        data: {
          receiver_id: adminId,
          notification_event_id: notificationEvent.id,
          entity_id: dto.entityId,
          status: 1,
          is_action_taken: false,
        },
        select: {
          id: true,
          entity_id: true,
          receiver_id: true,
          read_at: true,
          created_at: true,
          is_action_taken: true,
          sender_id: true,
          status: true,
          notification_event: {
            select: {
              type: true,
              text: true,
              actions: true,
              status: true,
            },
          },
        },
      });

      this.notificationGateway.sendNotification({
        userId: adminId,
        ...notification,
      });

      this.logger.log(`Notification sent to admin ${adminId}: ${dto.title}`);

      return {
        success: true,
        notification_id: notification.id,
        notification_event_id: notificationEvent.id,
      };
    } catch (error) {
      this.logger.error('Failed to send admin notification:', error);
      throw error;
    }
  }

  /**
   * Get notifications for an admin with filters
   */
  async getAdminNotifications(
    adminId: string,
    filters?: {
      unreadOnly?: boolean;
      type?: string;
      limit?: number;
      page?: number;
    },
  ) {
    const skip = (filters?.page - 1) * filters?.limit;
    if (!adminId) return [];
    const where: any = {
      receiver_id: adminId,
      status: 1,
      deleted_at: null,
    };

    if (filters?.unreadOnly) {
      where.read_at = null;
    }

    if (filters?.type) {
      where.notification_event = {
        type: filters.type,
      };
    }

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        select: {
          id: true,
          entity_id: true,
          receiver_id: true,
          read_at: true,
          created_at: true,
          is_action_taken: true,
          sender_id: true,
          status: true,
          notification_event: {
            select: {
              type: true,
              text: true,
              actions: true,
              status: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        take: filters?.limit || 50,
        skip,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      success: true,
      data: {
        notifications,
        pagination: {
          total,
          page: filters?.page || 1,
          limit: filters?.limit || 50,
          pages: Math.ceil(total / (filters?.limit || 50)),
        },
      },
    };
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(adminId: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        receiver_id: adminId,
        read_at: null,
        status: 1,
        deleted_at: null,
      },
    });
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string, adminId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        receiver_id: adminId,
      },
    });

    if (!notification) {
      throw new Error('Notification not found');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { read_at: new Date() },
    });
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(adminId: string) {
    return this.prisma.notification.updateMany({
      where: {
        receiver_id: adminId,
        read_at: null,
        status: 1,
      },
      data: { read_at: new Date() },
    });
  }

  /**
   * Delete notification (soft delete)
   */
  async deleteNotificationById(notificationId: string, adminId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        receiver_id: adminId,
      },
    });

    if (!notification) {
      throw new Error('Notification not found');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { deleted_at: new Date() },
    });
  }

  /**
   * Delete all notifications for an admin
   */
  async deleteAllNotifications(adminId: string) {
    return this.prisma.notification.deleteMany({
      where: {
        receiver_id: adminId,
      },
    });
  }

  // ===== Helper Methods for Semantic Messages =====

  /**
   * Migration job failed notification
   */
  async notifyMigrationJobFailed(params: {
    jobId: string;
    planId: string;
    planName: string;
    failedCount: number;
    totalCount: number;
    errorMessage?: string;
  }) {
    return this.sendToAllAdmins({
      type: 'MIGRATION',
      title: 'Migration Job Failed',
      message: `Migration job failed for plan "${params.planName}". ${params.failedCount} out of ${params.totalCount} subscriptions could not be migrated. ${params.errorMessage ? `Error: ${params.errorMessage}` : ''}`,
      metadata: {
        job_id: params.jobId,
        plan_id: params.planId,
        plan_name: params.planName,
        failed_count: params.failedCount,
        total_count: params.totalCount,
        error_message: params.errorMessage,
      },
      entityId: params.jobId,
    });
  }

  /**
   * Notice sending failed notification
   */
  async notifyNoticeSendingFailed(params: {
    jobId: string;
    planId: string;
    planName: string;
    failedCount: number;
    totalCount: number;
  }) {
    return this.sendToAllAdmins({
      type: 'NOTICE',
      title: 'Migration Notice Sending Failed',
      message: `Failed to send migration notices for plan "${params.planName}". ${params.failedCount} out of ${params.totalCount} email notifications could not be delivered. Please check email addresses and retry.`,
      metadata: {
        job_id: params.jobId,
        plan_id: params.planId,
        plan_name: params.planName,
        failed_count: params.failedCount,
        total_count: params.totalCount,
      },
      entityId: params.jobId,
    });
  }

  /**
   * Stripe sync failed notification
   */
  async notifyStripeSyncFailed(params: {
    planId: string;
    planName: string;
    operation: string;
    errorMessage: string;
  }) {
    return this.sendToAllAdmins({
      type: 'STRIPE',
      title: 'Stripe Synchronization Failed',
      message: `Failed to ${params.operation} for plan "${params.planName}" in Stripe. Error: ${params.errorMessage}. Please check Stripe API credentials and try again.`,
      metadata: {
        plan_id: params.planId,
        plan_name: params.planName,
        operation: params.operation,
        error_message: params.errorMessage,
      },
      entityId: params.planId,
    });
  }

  /**
   * Cron job failed notification
   */
  async notifyCronJobFailed(params: { jobName: string; errorMessage: string }) {
    return this.sendToAllAdmins({
      type: 'CRON',
      title: 'Scheduled Job Failed',
      message: `The scheduled job "${params.jobName}" failed to execute. Error: ${params.errorMessage}. This may affect subscription status updates and migrations.`,
      metadata: {
        job_name: params.jobName,
        error_message: params.errorMessage,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Mass subscription suspensions notification
   */
  async notifyMassSuspensions(params: {
    suspendedCount: number;
    normalAverage: number;
  }) {
    return this.sendToAllAdmins({
      type: 'SUSPENSION',
      title: 'Unusual Subscription Suspensions Detected',
      message: `${params.suspendedCount} subscriptions were suspended today, which is significantly higher than the normal average of ${params.normalAverage} per day. This may indicate a payment gateway issue or billing system problem.`,
      metadata: {
        suspended_count: params.suspendedCount,
        normal_average: params.normalAverage,
        date: new Date().toISOString(),
      },
    });
  }

  /**
   * Migration job completed successfully
   */
  async notifyMigrationSuccess(params: {
    jobId: string;
    planId: string;
    planName: string;
    migratedCount: number;
    totalCount: number;
  }) {
    return this.sendToAllAdmins({
      type: 'MIGRATION',
      title: 'Migration Job Completed Successfully',
      message: `Migration job completed for plan "${params.planName}". Successfully migrated ${params.migratedCount} out of ${params.totalCount} subscriptions to the new pricing.`,
      metadata: {
        job_id: params.jobId,
        plan_id: params.planId,
        plan_name: params.planName,
        migrated_count: params.migratedCount,
        total_count: params.totalCount,
      },
      entityId: params.jobId,
    });
  }

  /**
   * Revenue drop alert
   */
  async notifyRevenueDrop(params: {
    currentRevenue: number;
    previousRevenue: number;
    dropPercentage: number;
    cancellationCount: number;
  }) {
    const dropAmount = params.previousRevenue - params.currentRevenue;
    return this.sendToAllAdmins({
      type: 'REVENUE',
      title: 'Significant Revenue Drop Detected',
      message: `Monthly revenue has dropped by ${params.dropPercentage.toFixed(1)}% (£${(dropAmount / 100).toFixed(2)}). Current revenue: £${(params.currentRevenue / 100).toFixed(2)}, Previous: £${(params.previousRevenue / 100).toFixed(2)}. ${params.cancellationCount} subscriptions were cancelled this month.`,
      metadata: {
        current_revenue: params.currentRevenue,
        previous_revenue: params.previousRevenue,
        drop_percentage: params.dropPercentage,
        drop_amount: dropAmount,
        cancellation_count: params.cancellationCount,
      },
    });
  }
}
