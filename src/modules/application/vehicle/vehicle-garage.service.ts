import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserRole, ServiceType, Prisma } from '@prisma/client';
import { GarageDto } from './dto/garage-search-response.dto';
import {
  AdditionalServiceDto,
  BookableServiceDto,
} from './dto/garage-services.dto';
import { SojebStorage } from 'src/common/lib/Disk/SojebStorage';
import appConfig from 'src/config/app.config';

type LatLng = {
  lat: number;
  lng: number;
  outcode?: string;
  postcodeDisplay?: string;
};

@Injectable()
export class VehicleGarageService {
  private readonly logger = new Logger(VehicleGarageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find active garages by postcode
   * Only returns garages that are active and have subscription
   */
  async findActiveGarages(
    postcode: string,
    limit?: number,
    page?: number,
  ): Promise<GarageDto[]> {
    try {
      this.logger.log(
        `Searching for active garages near postcode: ${postcode}`,
      );

      // Extract postcode prefix for broader search (e.g., "M1" from "M1 1AA")
      const postcodePrefix = postcode.split(' ')[0].toUpperCase();

      const garages = await this.prisma.user.findMany({
        where: {
          type: UserRole.GARAGE,
          status: 1, // Active status
          // Note: Add subscription check when implemented
          // subscription_active: true,
          zip_code: {
            startsWith: postcodePrefix,
          },
        },
        select: {
          id: true,
          garage_name: true,
          address: true,
          zip_code: true,
          vts_number: true,
          primary_contact: true,
          phone_number: true,
        },
        orderBy: {
          garage_name: 'asc',
        },
      });

      this.logger.log(`Found ${garages.length} active garages`);

      // Transform to DTO format
      const garageDtos: GarageDto[] = garages.map((garage) => ({
        id: garage.id,
        garage_name: garage.garage_name || 'Unnamed Garage',
        address: garage.address || 'Address not provided',
        postcode: garage.zip_code || '',
        vts_number: garage.vts_number || 'VTS not provided',
        primary_contact: garage.primary_contact || 'Contact not provided',
        phone_number: garage.phone_number || 'Phone not provided',
        // TODO: Calculate distance when postcode service is implemented
        distance_miles: undefined,
      }));

      return garageDtos;
    } catch (error) {
      this.logger.error(`Error finding active garages: ${error.message}`);
      throw new BadRequestException('Failed to search for garages');
    }
  }

  // -------------------------------------
  private normalizeUkPostcode(input: string): string {
    return (input || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  async findActiveGaragesWithPagination(
    postcode?: string,
    limit = 20,
    page = 1,
  ) {
    try {
      this.logger.log(
        `Searching active garages. Postcode: ${postcode || 'N/A'}`,
      );

      const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
      const safePage = Math.max(Number(page) || 1, 1);
      const offset = (safePage - 1) * safeLimit;

      const normalizedPostcode = (postcode || '').trim().toUpperCase();

      // =========================================================
      // CASE 1: Postcode provided -> same postcode first + distance
      // =========================================================
      if (normalizedPostcode) {
        const postcodeNoSpace = this.normalizeUkPostcode(normalizedPostcode);

        // postcode -> lat/lng (cached)
        const center = await this.getLatLng(normalizedPostcode);

        const [rows, count] = await Promise.all([
          this.prisma.$queryRaw<
            Array<{
              id: string;
              garage_name: string | null;
              address: string | null;
              zip_code: string | null;
              vts_number: string | null;
              primary_contact: string | null;
              phone_number: string | null;
              distance_miles: number | null;
              avatar: string | null;
            }>
          >(Prisma.sql`
        SELECT
          u.id,
          u.garage_name,
          u.address,
          u.zip_code,
          u.vts_number,
          u.primary_contact,
          u.phone_number,
          u.avatar,

          CASE
            WHEN u.latitude IS NOT NULL AND u.longitude IS NOT NULL THEN
              (
                3959 * acos(
                  cos(radians(${center.lat})) * cos(radians(u.latitude)) *
                  cos(radians(u.longitude) - radians(${center.lng})) +
                  sin(radians(${center.lat})) * sin(radians(u.latitude))
                )
              )
            ELSE NULL
          END AS distance_miles

        FROM "users" u
        WHERE
          u.type = 'GARAGE'::"UserRole"
          AND u.status = 1

        ORDER BY
          CASE
            WHEN regexp_replace(upper(coalesce(u.zip_code, '')), '\\s+', '', 'g') = ${postcodeNoSpace}
            THEN 0 ELSE 1
          END ASC,
          CASE
            WHEN u.latitude IS NOT NULL AND u.longitude IS NOT NULL THEN 0
            ELSE 1
          END ASC,
          distance_miles ASC NULLS LAST,
          u.garage_name ASC NULLS LAST,
          u.id ASC

        LIMIT ${safeLimit}
        OFFSET ${offset};
      `),
          this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*) FROM "users" u
        WHERE
          u.type = 'GARAGE'::"UserRole"
          AND u.status = 1;
      `),
        ]);

        // Convert BigInt to Number for JSON serialization
        const totalCount = count[0]?.count ? Number(count[0].count) : 0;

        return {
          garages: rows.map((row) => ({
            id: row.id,
            garage_name: row.garage_name || 'Unnamed Garage',
            address: row.address || 'Address not provided',
            avatar: row.avatar
              ? SojebStorage.url(appConfig().storageUrl.avatar + row.avatar)
              : null,
            postcode: row.zip_code || '',
            vts_number: row.vts_number || 'VTS not provided',
            primary_contact: row.primary_contact || 'Contact not provided',
            phone_number: row.phone_number || 'Phone not provided',
            distance_miles:
              typeof row.distance_miles === 'number'
                ? Number(row.distance_miles.toFixed(2))
                : undefined,
          })),
          total_count: totalCount,
        };
      }

      // =========================================
      // CASE 2: No postcode -> normal deterministic sort (stable)
      // =========================================
      const [find_garages, count] = await Promise.all([
        this.prisma.user.findMany({
          where: {
            type: UserRole.GARAGE,
            status: 1,
          },
          select: {
            id: true,
            garage_name: true,
            address: true,
            zip_code: true,
            vts_number: true,
            primary_contact: true,
            phone_number: true,
            created_at: true,
            avatar: true,
          },
          orderBy: [
            { created_at: 'desc' }, // newest first (sensible default)
            { garage_name: 'asc' },
            { id: 'asc' }, // stable pagination
          ],
          take: safeLimit,
          skip: offset,
        }),
        this.prisma.user.count({
          where: {
            type: UserRole.GARAGE,
            status: 1,
          },
        }),
      ]);

      return {
        garages: find_garages.map((garage) => ({
          id: garage.id,
          garage_name: garage.garage_name || 'Unnamed Garage',
          address: garage.address || 'Address not provided',
          postcode: garage.zip_code || '',
          vts_number: garage.vts_number || 'VTS not provided',
          primary_contact: garage.primary_contact || 'Contact not provided',
          phone_number: garage.phone_number || 'Phone not provided',
          avatar: garage.avatar
            ? SojebStorage.url(appConfig().storageUrl.avatar + garage.avatar)
            : null,
          distance_miles: undefined,
        })),
        total_count: count,
      };
    } catch (error: any) {
      this.logger.error(
        `Error finding active garages: ${error?.message || error}`,
      );
      throw new BadRequestException('Failed to search for garages');
    }
  }

  async getLatLng(postcode: string): Promise<LatLng> {
    const raw = (postcode || '').trim();
    if (!raw) throw new BadRequestException('Invalid postcode');

    const normalized = this.normalizeUkPostcode(raw);

    // 1) DB cache hit
    const cached = await this.prisma.postcodeGeoCache.findUnique({
      where: { postcodeNormalized: normalized },
      select: {
        latitude: true,
        longitude: true,
        outcode: true,
        postcodeDisplay: true,
      },
    });

    if (cached) {
      return {
        lat: cached.latitude,
        lng: cached.longitude,
        outcode: cached.outcode ?? undefined,
        postcodeDisplay: cached.postcodeDisplay ?? undefined,
      };
    }

    // 2) Cache miss -> external lookup
    const url = `https://api.postcodes.io/postcodes/${encodeURIComponent(raw)}`;
    const response = await fetch(url);

    if (!response.ok) {
      this.logger.warn(
        `Postcode API failed: ${response.status} ${response.statusText}`,
      );
      throw new BadRequestException('Invalid postcode');
    }

    const data = await response.json();
    const result = data?.result;

    const lat = result?.latitude;
    const lng = result?.longitude;

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      throw new BadRequestException('Invalid postcode');
    }

    const outcode: string | undefined = result?.outcode ?? undefined;
    const postcodeDisplay: string | undefined = result?.postcode ?? undefined;

    // 3) Upsert cache
    await this.prisma.postcodeGeoCache.upsert({
      where: { postcodeNormalized: normalized },
      create: {
        postcodeNormalized: normalized,
        postcodeDisplay,
        latitude: lat,
        longitude: lng,
        outcode,
        source: 'postcodes.io',
      },
      update: {
        postcodeDisplay,
        latitude: lat,
        longitude: lng,
        outcode,
        source: 'postcodes.io',
      },
    });

    return { lat, lng, outcode, postcodeDisplay };
  }
  // ---------------------------------------------------------------------
  /**
   * Get garage services separated into bookable and additional
   * Also includes garage schedule (operating hours and weekly pattern)
   */
  async getGarageServices(garageId: string): Promise<any> {
    try {
      this.logger.log(`Fetching services for garage: ${garageId}`);

      // Verify garage exists and is active
      const garage = await this.prisma.user.findFirst({
        where: {
          id: garageId,
          type: UserRole.GARAGE,
          status: 1,
        },
      });

      if (!garage) {
        throw new NotFoundException('Garage not found or inactive');
      }

      // Fetch all services for the garage
      const services = await this.prisma.service.findMany({
        where: {
          garage_id: garageId,
        },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      });

      // Fetch garage schedule
      const schedule = await this.prisma.schedule.findUnique({
        where: { garage_id: garageId },
      });

      // Parse schedule data if exists
      let scheduleData = null;
      if (schedule) {
        const restrictions = Array.isArray(schedule.restrictions)
          ? schedule.restrictions
          : JSON.parse(schedule.restrictions as string);

        let daily_hours: any = null;
        if (
          (schedule as any).daily_hours !== undefined &&
          (schedule as any).daily_hours !== null
        ) {
          const dh = (schedule as any).daily_hours as any;
          if (typeof dh === 'string') {
            try {
              daily_hours = JSON.parse(dh);
            } catch {
              daily_hours = null;
            }
          } else {
            daily_hours = dh;
          }
        }

        scheduleData = {
          id: schedule.id,
          start_time: schedule.start_time,
          end_time: schedule.end_time,
          slot_duration: schedule.slot_duration,
          restrictions,
          daily_hours,
          is_active: schedule.is_active,
        };
      }

      // Separate services into bookable and additional
      const bookableServices: BookableServiceDto[] = [];
      const additionalServices: AdditionalServiceDto[] = [];

      services.forEach((service) => {
        if (
          service.type === ServiceType.MOT ||
          service.type === ServiceType.RETEST
        ) {
          // Bookable services (MOT and Retest)
          bookableServices.push({
            id: service.id,
            name: service.name,
            type: service.type as 'MOT' | 'RETEST',
            price: Number(service.price) || 0,
          });
        } else if (service.type === ServiceType.ADDITIONAL) {
          // Additional services (showcase only)
          additionalServices.push({
            id: service.id,
            name: service.name,
            type: 'ADDITIONAL',
          });
        }
      });

      this.logger.log(
        `Found ${bookableServices.length} bookable services and ${additionalServices.length} additional services`,
      );

      return {
        garage: {
          id: garage.id,
          garage_name: garage.garage_name,
          address: garage.address,
          zip_code: garage.zip_code,
          vts_number: garage.vts_number,
          primary_contact: garage.primary_contact,
          phone_number: garage.phone_number,
        },
        services: bookableServices,
        additionals: additionalServices,
        schedule: scheduleData, // Include schedule in response
      };
    } catch (error) {
      this.logger.error(`Error fetching garage services: ${error.message}`);
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Failed to fetch garage services');
    }
  }

  /**
   * Validate if a garage can accept bookings
   */
  async validateGarageAvailability(garageId: string): Promise<boolean> {
    try {
      const garage = await this.prisma.user.findFirst({
        where: {
          id: garageId,
          type: UserRole.GARAGE,
          status: 1,
        },
        select: {
          id: true,
          // Add subscription check when implemented
          has_subscription: true,
          subscription_expires_at: true,
        },
      });

      if (!garage) {
        return false;
      }

      if (!garage.has_subscription) {
        return false;
      }

      if (garage.subscription_expires_at) {
        const now = new Date();
        if (garage.subscription_expires_at < now) {
          return false;
        }
      }

      return true;
    } catch (error) {
      this.logger.error(
        `Error validating garage availability: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Get garage details by ID
   */
  async getGarageById(garageId: string): Promise<GarageDto | null> {
    try {
      const garage = await this.prisma.user.findFirst({
        where: {
          id: garageId,
          type: UserRole.GARAGE,
          status: 1,
        },
        select: {
          id: true,
          garage_name: true,
          address: true,
          zip_code: true,
          vts_number: true,
          primary_contact: true,
          phone_number: true,
        },
      });

      if (!garage) {
        return null;
      }

      return {
        id: garage.id,
        garage_name: garage.garage_name || 'Unnamed Garage',
        address: garage.address || 'Address not provided',
        postcode: garage.zip_code || '',
        vts_number: garage.vts_number || 'VTS not provided',
        primary_contact: garage.primary_contact || 'Contact not provided',
        phone_number: garage.phone_number || 'Phone not provided',
        distance_miles: undefined,
      };
    } catch (error) {
      this.logger.error(`Error fetching garage details: ${error.message}`);
      return null;
    }
  }
}
