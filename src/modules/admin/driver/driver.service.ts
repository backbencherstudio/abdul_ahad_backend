import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class DriverService {
  constructor(private readonly prisma: PrismaService) {}

  async getDrivers(page: number, limit: number, status?: string) {
    const skip = (page - 1) * limit;

    const whereClause: any = { type: 'DRIVER' };
    if (status) {
      whereClause.status = parseInt(status, 10);
    }

    const [drivers, total] = await Promise.all([
      this.prisma.user.findMany({
        where: whereClause,
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          email: true,
          phone_number: true,
          status: true,
          created_at: true,
          approved_at: true,
          address: true,
          city: true,
          state: true,
          country: true,
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.user.count({ where: whereClause }),
    ]);

    return {
      success: true,
      data: {
        drivers,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    };
  }

  async getDriverById(id: string) {
    const driver = await this.prisma.user.findFirst({
      where: { id, type: 'DRIVER' },
      select: {
        id: true,
        name: true,
        email: true,
        phone_number: true,
        status: true,
        created_at: true,
        approved_at: true,
        address: true,
        city: true,
        state: true,
        country: true,
        zip_code: true,
        date_of_birth: true,
        gender: true,
        vehicles: {
          select: {
            id: true,
            registration_number: true,
            make: true,
            model: true,
            color: true,
            mot_expiry_date: true,
          },
        },
      },
    });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    return {
      success: true,
      data: driver,
    };
  }

  async approveDriver(id: string) {
    const driver = await this.prisma.user.findFirst({
      where: { id, type: 'DRIVER' },
    });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    if (driver.status === 1) {
      throw new BadRequestException('Driver is already approved');
    }

    const updatedDriver = await this.prisma.user.update({
      where: { id },
      data: {
        status: 1,
        approved_at: new Date(),
      },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        approved_at: true,
      },
    });

    return {
      success: true,
      message: 'Driver approved successfully',
      data: updatedDriver,
    };
  }

  async rejectDriver(id: string) {
    const driver = await this.prisma.user.findFirst({
      where: { id, type: 'DRIVER' },
    });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    if (driver.status === 0) {
      throw new BadRequestException('Driver is already rejected');
    }

    const updatedDriver = await this.prisma.user.update({
      where: { id },
      data: {
        status: 0,
        approved_at: null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        approved_at: true,
      },
    });

    return {
      success: true,
      message: 'Driver rejected successfully',
      data: updatedDriver,
    };
  }
}
