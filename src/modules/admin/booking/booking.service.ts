import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class BookingService {
  constructor(private readonly prisma: PrismaService) {}

  async getBookings(
    page: number,
    limit: number,
    status?: string,
    startDate?: string,
    endDate?: string,
  ) {
    const skip = (page - 1) * limit;

    const whereClause: any = {};
    if (status) {
      whereClause.status = status;
    }

    if (startDate || endDate) {
      whereClause.created_at = {};
      if (startDate) {
        whereClause.created_at.gte = new Date(startDate);
      }
      if (endDate) {
        whereClause.created_at.lte = new Date(endDate);
      }
    }

    const [bookings, total] = await Promise.all([
      this.prisma.order.findMany({
        where: whereClause,
        skip,
        take: limit,
        include: {
          driver: {
            select: {
              id: true,
              name: true,
              email: true,
              phone_number: true,
            },
          },
          garage: {
            select: {
              id: true,
              garage_name: true,
              email: true,
              phone_number: true,
            },
          },
          vehicle: {
            select: {
              id: true,
              registration_number: true,
              make: true,
              model: true,
              color: true,
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
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.order.count({ where: whereClause }),
    ]);

    return {
      success: true,
      data: {
        bookings,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    };
  }

  async getBookingById(id: string) {
    const booking = await this.prisma.order.findUnique({
      where: { id },
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            email: true,
            phone_number: true,
            address: true,
          },
        },
        garage: {
          select: {
            id: true,
            garage_name: true,
            email: true,
            phone_number: true,
            address: true,
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
        payment_transactions: {
          select: {
            id: true,
            amount: true,
            status: true,
            type: true,
            created_at: true,
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
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    return {
      success: true,
      data: booking,
    };
  }

  async updateBookingStatus(id: string, status: string) {
    const validStatuses = [
      'PENDING',
      'ACCEPTED',
      'REJECTED',
      'COMPLETED',
      'CANCELLED',
    ];

    if (!validStatuses.includes(status)) {
      throw new BadRequestException(
        `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      );
    }

    const booking = await this.prisma.order.findUnique({
      where: { id },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    const updatedBooking = await this.prisma.order.update({
      where: { id },
      data: { status: status as any },
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        garage: {
          select: {
            id: true,
            garage_name: true,
            email: true,
          },
        },
      },
    });

    return {
      success: true,
      message: `Booking status updated to ${status}`,
      data: updatedBooking,
    };
  }

  async cancelBooking(id: string) {
    const booking = await this.prisma.order.findUnique({
      where: { id },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.status === 'CANCELLED') {
      throw new BadRequestException('Booking is already cancelled');
    }

    if (booking.status === 'COMPLETED') {
      throw new BadRequestException('Cannot cancel a completed booking');
    }

    const updatedBooking = await this.prisma.order.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        garage: {
          select: {
            id: true,
            garage_name: true,
            email: true,
          },
        },
      },
    });

    return {
      success: true,
      message: 'Booking cancelled successfully',
      data: updatedBooking,
    };
  }
}
