import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class VehicleService {
  constructor(private readonly prisma: PrismaService) {}

  async getVehicles(
    page: number,
    limit: number,
    status?: string,
    search?: string,
    startdate?: string,
    enddate?: string,
  ) {
    const skip = (page - 1) * limit;

    const whereClause: any = {
      user: {
        type: 'DRIVER',
        deleted_at: null, // Exclude soft-deleted users
      },
    };

    if (search && search.trim() !== '') {
      const searchFilter = {
        contains: search,
        // mode: 'insensitive',
      };

      whereClause.OR = [
        // User (string only)
        { user: { name: searchFilter } },
        { user: { email: searchFilter } },
        { user: { phone_number: searchFilter } },
        { user: { address: searchFilter } },
        { user: { city: searchFilter } },
        { user: { state: searchFilter } },
        { user: { country: searchFilter } },
        { user: { zip_code: searchFilter } },

        // Vehicle (string only)
        { registration_number: searchFilter },
        { make: searchFilter },
        { model: searchFilter },
        { color: searchFilter },
        { fuel_type: searchFilter },
      ];

      // 🔢 Numeric search support
      const numericSearch = Number(search);
      if (!isNaN(numericSearch)) {
        whereClause.OR.push(
          { year_of_manufacture: numericSearch },
          { engine_capacity: numericSearch },
          { co2_emissions: numericSearch },
        );
      }

      // 📅 Date search support
      const dateSearch = new Date(search);
      if (!isNaN(dateSearch.getTime())) {
        whereClause.OR.push({
          mot_expiry_date: {
            equals: dateSearch,
          },
        });
      }
    }

    if (startdate && enddate) {
      whereClause.mot_expiry_date = {
        gte: new Date(startdate),
        lte: new Date(enddate + 'T23:59:59.999Z'),
      };
    }

    // Handle status filter - only apply if status is a valid number, not "all" or empty
    if (status && status !== 'all' && status !== '') {
      const statusNum = parseInt(status, 10);
      if (!isNaN(statusNum)) {
        whereClause.user.status = statusNum;
      }
    }
    const [vehicles, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where: whereClause,
        select: {
          id: true,
          registration_number: true,
          make: true,
          model: true,
          color: true,
          mot_expiry_date: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone_number: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.vehicle.count({ where: whereClause }),
    ]);

    return {
      success: true,
      data: {
        vehicles,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    };
  }
}
