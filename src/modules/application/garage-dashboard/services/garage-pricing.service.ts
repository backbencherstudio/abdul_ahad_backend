import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { CreateServiceDto } from '../dto/create-service.dto';
import { UpdateServiceDto } from '../dto/update-service.dto';
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
    const { mot, retest, additionals } = body;

    // --- MOT ---
    let motService = null;
    if (mot) {
      if (!mot.name || mot.price === undefined || mot.price === null) {
        throw new BadRequestException('MOT name and price are required.');
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
      if (!retest.name || retest.price === undefined || retest.price === null) {
        throw new BadRequestException('Retest name and price are required.');
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

    // --- ADDITIONALS ---
    const additionalResults = [];
    if (additionals && Array.isArray(additionals)) {
      // Check for duplicate names in the request
      const names = new Set<string>();
      for (const add of additionals) {
        if (!add.name || add.price === undefined || add.price === null) {
          throw new BadRequestException(
            'Additional service name and price are required.',
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

      // Check for duplicate names in DB (excluding self for updates)
      const dbAdditionals = await this.prisma.service.findMany({
        where: { garage_id: garageId, type: ServiceType.ADDITIONAL },
      });
      for (const add of additionals) {
        if (
          dbAdditionals.some(
            (db) =>
              db.name.trim().toLowerCase() === add.name.trim().toLowerCase() &&
              db.id !== add.id,
          )
        ) {
          throw new BadRequestException(
            `Additional service name already exists: ${add.name}`,
          );
        }
      }

      // Upsert each additional service
      for (const add of additionals) {
        let result;
        if (add.id) {
          result = await this.prisma.service.update({
            where: { id: add.id },
            data: { name: add.name, price: add.price },
          });
        } else {
          result = await this.prisma.service.create({
            data: {
              garage_id: garageId,
              name: add.name,
              price: add.price,
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
        additionals: additionalResults,
      },
    };
  }
}
