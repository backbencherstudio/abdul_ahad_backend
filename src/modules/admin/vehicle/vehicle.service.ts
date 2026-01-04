import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { VehicleExpiryStatus } from './dto/query-vehicle.dto';
import { Prisma } from '@prisma/client';
import { UpdateMotReminderSettingsDto } from './dto/update-mot-reminder.dto';
import { Logger } from '@nestjs/common';

@Injectable()
export class VehicleService {
  constructor(private readonly prisma: PrismaService) {}

  async getVehicles(
    page: number,
    limit: number,
    expiry_status?: string,
    search?: string,
    startdate?: Date,
    enddate?: Date,
    sort_by_expiry?: string,
  ) {
    const skip = (page - 1) * limit;
    let orderBy: Prisma.VehicleOrderByWithRelationInput = {
      created_at: 'desc',
    };

    const whereClause: any = {
      user: {
        type: 'DRIVER',
        deleted_at: null, // Exclude soft-deleted users
      },
    };

    if (search && search.trim() !== '') {
      const searchFilter = {
        contains: search,
        mode: 'insensitive',
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

    if (expiry_status) {
      switch (expiry_status) {
        case VehicleExpiryStatus.EXPIRED:
          whereClause.is_expired = true;
          break;
        case VehicleExpiryStatus.EXPIRED_SOON:
          whereClause.is_expired = false;
          whereClause.mot_expiry_date = {
            gte: new Date(),
            lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          };
          whereClause.NOT = {
            mot_expiry_date: null,
          };
          if (sort_by_expiry !== 'asc' && sort_by_expiry !== 'desc') {
            orderBy = { mot_expiry_date: 'asc' };
          }
          break;
        case VehicleExpiryStatus.NOT_EXPIRED:
          whereClause.mot_expiry_date = {
            gte: new Date(),
          };
          whereClause.is_expired = false;
          whereClause.NOT = {
            mot_expiry_date: null,
          };
          break;
      }
    }
    if (sort_by_expiry) {
      orderBy =
        sort_by_expiry === 'asc' || sort_by_expiry === 'desc'
          ? { mot_expiry_date: sort_by_expiry as 'asc' | 'desc' }
          : { created_at: 'desc' };
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
          is_expired: true,
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
        orderBy,
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

  async deleteVehicle(id: string) {
    const vehicle = await this.prisma.vehicle.delete({
      where: { id },
    });

    return {
      success: true,
      message: 'Vehicle deleted successfully',
      data: vehicle,
    };
  }

  private readonly logger = new Logger(VehicleService.name);

  /**
   * Get MOT reminder settings from the database
   */
  async getMotReminderSettings() {
    try {
      const [periodsSetting, activeSetting, messageSetting] = await Promise.all(
        [
          this.prisma.setting.findUnique({
            where: { key: 'MOT_REMINDER_PERIODS' },
          }),
          this.prisma.setting.findUnique({
            where: { key: 'MOT_REMINDER_ACTIVE' },
          }),
          this.prisma.setting.findUnique({
            where: { key: 'MOT_REMINDER_MESSAGE' },
          }),
        ],
      );

      return {
        success: true,
        data: {
          reminderPeriods: periodsSetting?.default_value
            ? periodsSetting.default_value.split(',').map(Number)
            : [7],
          autoReminder: activeSetting?.default_value === 'true',
          reminderMessage:
            messageSetting?.default_value ||
            'Your vehicle {make} {model} ({registration}) has an MOT expiring in {days} days.',
        },
      };
    } catch (error) {
      this.logger.error('Failed to fetch MOT reminder settings:', error);
      return {
        success: false,
        message: 'Failed to fetch MOT reminder settings',
      };
    }
  }

  /**
   * Update MOT reminder settings in the database
   */
  async updateMotReminderSettings(dto: UpdateMotReminderSettingsDto) {
    try {
      await this.prisma.$transaction([
        this.prisma.setting.upsert({
          where: { key: 'MOT_REMINDER_PERIODS' },
          update: { default_value: dto.reminderPeriods.join(',') },
          create: {
            key: 'MOT_REMINDER_PERIODS',
            category: 'VEHICLE',
            label: 'MOT Reminder Periods',
            default_value: dto.reminderPeriods.join(','),
          },
        }),
        this.prisma.setting.upsert({
          where: { key: 'MOT_REMINDER_ACTIVE' },
          update: { default_value: String(dto.autoReminder) },
          create: {
            key: 'MOT_REMINDER_ACTIVE',
            category: 'VEHICLE',
            label: 'MOT Reminder Active',
            default_value: String(dto.autoReminder),
          },
        }),
        this.prisma.setting.upsert({
          where: { key: 'MOT_REMINDER_MESSAGE' },
          update: { default_value: dto.reminderMessage || '' },
          create: {
            key: 'MOT_REMINDER_MESSAGE',
            category: 'VEHICLE',
            label: 'MOT Reminder Message',
            default_value: dto.reminderMessage || '',
          },
        }),
      ]);

      return {
        success: true,
        message: 'MOT reminder settings updated successfully',
      };
    } catch (error) {
      this.logger.error('Failed to update MOT reminder settings:', error);
      return {
        success: false,
        message: 'Failed to update MOT reminder settings',
      };
    }
  }
}
