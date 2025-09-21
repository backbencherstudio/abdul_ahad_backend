import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class GarageService {
  constructor(private readonly prisma: PrismaService) {}

  async getGarages(page: number, limit: number, status?: string) {
    const skip = (page - 1) * limit;

    const whereClause: any = { type: 'GARAGE' };
    if (status) {
      whereClause.status = parseInt(status, 10);
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

    if (garage.status === 1) {
      throw new BadRequestException('Garage is already approved');
    }

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

    return {
      success: true,
      message: 'Garage rejected successfully',
      data: updatedGarage,
    };
  }
}
