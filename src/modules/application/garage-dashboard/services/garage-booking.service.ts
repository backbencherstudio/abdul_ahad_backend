import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { GetBookingsDto, BookingStatusFilter } from '../dto/get-bookings.dto';
import { OrderStatus, Prisma } from '@prisma/client';
import { NotificationService } from '../../notification/notification.service';
import { NotificationType } from 'src/common/repository/notification/notification.repository';

@Injectable()
export class GarageBookingService {
  private readonly logger = new Logger(GarageBookingService.name);

  constructor(
    private prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async getBookings(userId: string, query: GetBookingsDto) {
    const { search, status, page = 1, limit = 10 } = query;

    // Build where clause
    const where: Prisma.OrderWhereInput = {
      garage_id: userId,
    };

    // Apply status filter
    if (status && status !== BookingStatusFilter.ALL) {
      where.status = status as OrderStatus;
    }

    // Apply search filter
    if (search && search.trim()) {
      where.OR = [
        {
          vehicle: {
            registration_number: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
        {
          driver: {
            name: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
        {
          vehicle: {
            make: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
        {
          vehicle: {
            model: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
        {
          vehicle: {
            color: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
        {
          vehicle: {
            fuel_type: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
        {
          driver: {
            email: {
              contains: search,
              mode: 'insensitive',
            },
          },
        },
      ];
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Get total count
    const total = await this.prisma.order.count({ where });

    // Get bookings with relations
    const bookings = await this.prisma.order.findMany({
      where,
      select: {
        id: true,
        created_at: true,
        order_date: true,
        status: true,
        total_amount: true,
        garage_id: true,
        vehicle_id: true,
        driver: {
          select: {
            id: true,
            name: true,
            email: true,
            phone_number: true,
          },
        },
        slot: {
          select: {
            id: true,
            start_datetime: true,
            end_datetime: true,
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
      skip,
      take: limit,
    });

    return {
      success: true,
      message: 'Bookings retrieved successfully',
      data: bookings,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getBooking(userId: string, bookingId: string) {
    const booking = await this.prisma.order.findFirst({
      where: {
        id: bookingId,
        garage_id: userId,
      },
      select: {
        id: true,
        created_at: true,
        order_date: true,
        status: true,
        total_amount: true,
        garage_id: true,
        driver: {
          select: {
            id: true,
            name: true,
            email: true,
            phone_number: true,
            address: true,
            zip_code: true,
          },
        },
        vehicle: {
          select: {
            id: true,
            registration_number: true,
            make: true,
            model: true,
            color: true,
            fuel_type: true,
            year_of_manufacture: true,
            mot_expiry_date: true,
          },
        },
        slot: {
          select: {
            id: true,
            start_datetime: true,
            end_datetime: true,
          },
        },
        items: {
          include: {
            service: {
              select: {
                id: true,
                name: true,
                type: true,
                price: true,
              },
            },
          },
        },
        // payment_transactions: {
        //   select: {
        //     id: true,
        //     amount: true,
        //     currency: true,
        //     status: true,
        //     provider: true,
        //     created_at: true,
        //   },
        // },
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    return {
      success: true,
      message: 'Booking retrieved successfully',
      data: booking,
    };
  }

  async updateBookingStatus(
    userId: string,
    bookingId: string,
    status: OrderStatus,
  ) {
    const booking = await this.prisma.order.findFirst({
      where: {
        id: bookingId,
        garage_id: userId,
      },
      select: {
        id: true,
        status: true,
        driver_id: true,
        order_date: true,
        slot_id: true,
        garage: {
          select: {
            garage_name: true,
          },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // ❌ Already rejected → no further update allowed
    if (booking.status === OrderStatus.REJECTED) {
      throw new BadRequestException('Rejected booking cannot be updated');
    }

    const updatedBooking = await this.prisma.$transaction(async (tx) => {
      // Update order status
      const order = await tx.order.update({
        where: { id: bookingId },
        data: {
          status,
          ...(status === OrderStatus.REJECTED && { slot: null }),
        },
        include: {
          driver: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
          vehicle: {
            select: {
              registration_number: true,
            },
          },
        },
      });

      // Only when rejected → free slot
      if (status === OrderStatus.REJECTED && booking.slot_id) {
        await tx.timeSlot.update({
          where: { id: booking.slot_id },
          data: {
            order: null,
            is_available: true,
          },
        });
      }

      return order;
    });

    await this.notificationService.create({
      receiver_id: booking.driver_id,
      sender_id: userId,
      type: NotificationType.BOOKING,
      text:
        status === OrderStatus.ACCEPTED
          ? `Your booking with ${booking.garage.garage_name} has been accepted on ${booking.order_date.toISOString().split('T')[0]} at ${booking.order_date.toISOString().split('T')[1]}.`
          : `Your booking with ${booking.garage.garage_name} has been rejected on ${booking.order_date.toISOString().split('T')[0]} at ${booking.order_date.toISOString().split('T')[1]}.`,
      entity_id: booking.id,
    });

    return {
      success: true,
      message: 'Booking status updated successfully',
      data: updatedBooking,
    };
  }
}
