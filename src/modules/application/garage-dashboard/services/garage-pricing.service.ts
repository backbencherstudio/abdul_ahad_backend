import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';

import { ServiceType } from '@prisma/client';

@Injectable()
export class GaragePricingService {
  constructor(private prisma: PrismaService) {}

  async getServices(garageId: string) {
    const services = await this.prisma.service.findMany({
      where: { garage_id: garageId },
      orderBy: { type: 'asc' },
    });
    return { success: true, data: services };
  }

  async deleteService(garageId: string, id: string) {
    const service = await this.prisma.service.findFirst({
      where: { id, garage_id: garageId },
    });
    if (!service) throw new NotFoundException('Service not found');
    await this.prisma.service.delete({ where: { id } });
    return { success: true, message: 'Service deleted successfully' };
  }

  async upsertServicePrice(garageId: string, body: any) {
    const { mot, retest, additional } = body;

    // --- MOT ---
    let motService = null;
    if (mot) {
      if (
        !mot.name ||
        mot.price === undefined ||
        mot.price === null ||
        mot.price <= 0
      ) {
        throw new BadRequestException('MOT requires name and valid price > 0');
      }
      motService = await this.prisma.service.findFirst({
        where: { garage_id: garageId, type: ServiceType.MOT },
      });
      if (motService) {
        motService = await this.prisma.service.update({
          where: { id: motService.id },
          data: { name: mot.name, price: mot.price },
        });
      } else {
        motService = await this.prisma.service.create({
          data: {
            garage_id: garageId,
            name: mot.name,
            price: mot.price,
            type: ServiceType.MOT,
          },
        });
      }
    }

    // --- RETEST ---
    let retestService = null;
    if (retest) {
      if (
        !retest.name ||
        retest.price === undefined ||
        retest.price === null ||
        retest.price <= 0
      ) {
        throw new BadRequestException(
          'Retest requires name and valid price > 0',
        );
      }
      retestService = await this.prisma.service.findFirst({
        where: { garage_id: garageId, type: ServiceType.RETEST },
      });
      if (retestService) {
        retestService = await this.prisma.service.update({
          where: { id: retestService.id },
          data: { name: retest.name, price: retest.price },
        });
      } else {
        retestService = await this.prisma.service.create({
          data: {
            garage_id: garageId,
            name: retest.name,
            price: retest.price,
            type: ServiceType.RETEST,
          },
        });
      }
    }

    // --- ADDITIONAL ---
    const additionalResults = [];
    if (additional && Array.isArray(additional)) {
      // Check for duplicate names in the request
      const names = new Set<string>();
      for (const add of additional) {
        if (!add.name) {
          throw new BadRequestException('Additional service name is required');
        }
        if (add.price !== undefined && add.price !== null) {
          throw new BadRequestException(
            'Additional services should not have prices',
          );
        }
        const lower = add.name.trim().toLowerCase();
        if (names.has(lower)) {
          throw new BadRequestException(
            `Duplicate additional service name in request: ${add.name}`,
          );
        }
        names.add(lower);
      }

      // Fetch existing additional from DB
      const dbAdditional = await this.prisma.service.findMany({
        where: { garage_id: garageId, type: ServiceType.ADDITIONAL },
      });

      // Filter additional to skip those that already exist in DB with the same name (excluding self)
      const validAdditional = additional.filter((add) => {
        return !dbAdditional.some(
          (db) =>
            db.name.trim().toLowerCase() === add.name.trim().toLowerCase() &&
            db.id !== add.id,
        );
      });

      // Upsert each valid additional service
      for (const add of validAdditional) {
        let result;
        if (add.id) {
          result = await this.prisma.service.update({
            where: { id: add.id },
            data: { name: add.name, price: null }, // Always set price to null for additional
          });
        } else {
          result = await this.prisma.service.create({
            data: {
              garage_id: garageId,
              name: add.name,
              price: null, // Always null for additional services
              type: ServiceType.ADDITIONAL,
            },
          });
        }
        additionalResults.push(result);
      }
    }

    return {
      success: true,
      message: 'Service prices updated successfully',
      data: {
        mot: motService,
        retest: retestService,
        additional: additionalResults,
      },
    };
  }
}
