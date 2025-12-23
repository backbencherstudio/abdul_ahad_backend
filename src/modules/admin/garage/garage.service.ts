import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { MailService } from 'src/mail/mail.service';
import { NotificationService } from '../../application/notification/notification.service';
import { NotificationType } from 'src/common/repository/notification/notification.repository';

@Injectable()
export class GarageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly notificationService: NotificationService,
  ) {}

  async getGarages(page: number, limit: number, q?: string, status?: string) {
    const skip = (page - 1) * limit;

    const whereClause: any = {
      type: 'GARAGE',
      deleted_at: null, // Exclude soft-deleted users
    };

    // Handle status filter - only apply if status is a valid number, not "all" or empty
    if (status && status !== 'all' && status !== '') {
      const statusNum = parseInt(status, 10);
      if (!isNaN(statusNum)) {
        whereClause.status = statusNum;
      }
    }

    // Handle search filter
    if (q) {
      whereClause.OR = [
        { id: { contains: q } },
        { garage_name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone_number: { contains: q, mode: 'insensitive' } },
        { address: { contains: q, mode: 'insensitive' } },
        { vts_number: { contains: q, mode: 'insensitive' } },
        { primary_contact: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [garages, total] = await Promise.all([
      this.prisma.user.findMany({
        where: whereClause,
        skip,
        take: limit,
        select: {
          id: true,
          garage_name: true,
          email: true,
          phone_number: true,
          address: true,
          status: true,
          created_at: true,
          approved_at: true,
          vts_number: true,
          primary_contact: true,
          type: true, // Add type to see what's actually stored
          deleted_at: true, // Add deleted_at to check soft delete status
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.user.count({ where: whereClause }),
    ]);

    return {
      success: true,
      data: {
        garages,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    };
  }

  async getGarageById(id: string) {
    const garage = await this.prisma.user.findFirst({
      where: { id, type: 'GARAGE' },
      select: {
        id: true,
        garage_name: true,
        email: true,
        phone_number: true,
        address: true,
        status: true,
        created_at: true,
        approved_at: true,
        vts_number: true,
        primary_contact: true,
        zip_code: true,
        city: true,
        state: true,
        country: true,
      },
    });

    if (!garage) {
      throw new NotFoundException('Garage not found');
    }

    return {
      success: true,
      data: garage,
    };
  }

  async approveGarage(id: string) {
    const garage = await this.prisma.user.findFirst({
      where: { id, type: 'GARAGE' },
    });

    if (!garage) {
      throw new NotFoundException('Garage not found');
    }

    // Check if garage is already approved with a timestamp
    if (garage.status === 1 && garage.approved_at !== null) {
      throw new BadRequestException('Garage is already approved');
    }

    // Always set both status and approved_at when approving
    // This handles cases where status is 1 but approved_at is null
    const updatedGarage = await this.prisma.user.update({
      where: { id },
      data: {
        status: 1,
        approved_at: new Date(),
      },
      select: {
        id: true,
        garage_name: true,
        email: true,
        status: true,
        approved_at: true,
      },
    });

    // Send approval email notification
    await this.mailService.sendUserNotification({
      to: updatedGarage.email,
      userType: 'garage',
      actionType: 'approved',
      userName: updatedGarage.garage_name,
    });

    // Send in-app notification
    // TODO: Uncomment when in-app notifications are needed for garage management
    // try {
    //   await this.notificationService.create({
    //     receiver_id: updatedGarage.id,
    //     type: NotificationType.ROLE_MANAGEMENT,
    //     text: `Your garage account has been approved! You can now start accepting bookings.`,
    //     entity_id: updatedGarage.id,
    //   });
    // } catch (error) {
    //   console.error('Failed to send garage approval in-app notification:', error);
    // }

    return {
      success: true,
      message: 'Garage approved successfully',
      data: updatedGarage,
    };
  }

  async rejectGarage(id: string) {
    const garage = await this.prisma.user.findFirst({
      where: { id, type: 'GARAGE' },
    });

    if (!garage) {
      throw new NotFoundException('Garage not found');
    }

    if (garage.status === 0) {
      throw new BadRequestException('Garage is already rejected');
    }

    const updatedGarage = await this.prisma.user.update({
      where: { id },
      data: {
        status: 0,
        approved_at: null,
      },
      select: {
        id: true,
        garage_name: true,
        email: true,
        status: true,
        approved_at: true,
      },
    });

    // Send rejection email notification
    await this.mailService.sendUserNotification({
      to: updatedGarage.email,
      userType: 'garage',
      actionType: 'rejected',
      userName: updatedGarage.garage_name,
    });

    // Send in-app notification
    // TODO: Uncomment when in-app notifications are needed for garage management
    // try {
    //   await this.notificationService.create({
    //     receiver_id: updatedGarage.id,
    //     type: NotificationType.ROLE_MANAGEMENT,
    //     text: `Your garage account application has been reviewed. Please check your email for more details.`,
    //     entity_id: updatedGarage.id,
    //   });
    // } catch (error) {
    //   console.error('Failed to send garage rejection in-app notification:', error);
    // }

    return {
      success: true,
      message: 'Garage rejected successfully',
      data: updatedGarage,
    };
  }
}
