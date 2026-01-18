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
    search?: string,
  ) {
    // Validate dates if provided
    const skip = (page - 1) * limit;

    const whereClause: any = {};
    const andConditions: any[] = [];

    if (status) {
      andConditions.push({ status });
    }

    if (startDate || endDate) {
      const dateFilter: any = {};
      if (startDate) {
        // Ensure format YYYY-MM-DD covers the full day from 00:00:00.000
        const start = new Date(`${startDate}T00:00:00.000Z`);

        if (isNaN(start.getTime())) {
          throw new BadRequestException('Invalid start date');
        }
        dateFilter.gte = start;
      }
      if (endDate) {
        // Ensure format YYYY-MM-DD covers the full day until 23:59:59.999
        const end = new Date(`${endDate}T23:59:59.999Z`);

        if (isNaN(end.getTime())) {
          throw new BadRequestException('Invalid end date');
        }
        dateFilter.lte = end;
      }
      andConditions.push({
        slot: {
          start_datetime: dateFilter,
        },
      });
    }

    if (search) {
      andConditions.push({
        OR: [
          { id: { contains: search, mode: 'insensitive' } },
          {
            driver: {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { first_name: { contains: search, mode: 'insensitive' } },
                { last_name: { contains: search, mode: 'insensitive' } },
                { username: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone_number: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
          {
            garage: {
              OR: [
                { garage_name: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
                { first_name: { contains: search, mode: 'insensitive' } },
                { last_name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone_number: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
          {
            vehicle: {
              registration_number: { contains: search, mode: 'insensitive' },
            },
          },
        ],
      });
    }

    if (andConditions.length > 0) {
      whereClause.AND = andConditions;
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
      data: { status: 'CANCELLED', slot: null },
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
    await this.prisma.timeSlot.update({
      where: { id: booking.slot_id },
      data: {
        order: null,
        is_available: true,
      },
    });

    return {
      success: true,
      message: 'Booking cancelled successfully',
      data: updatedBooking,
    };
  }
}
