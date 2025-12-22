import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';

import { ServiceType } from '@prisma/client';
import { UpsertServicePriceDto } from '../dto/upsert-service-price.dto';

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

  async upsertServicePrice(garageId: string, body: UpsertServicePriceDto) {
    const { mot, retest, additionals } = body;

    // =========================
    // MOT
    // =========================
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

      const existingMot = await this.prisma.service.findFirst({
        where: { garage_id: garageId, type: ServiceType.MOT },
      });

      motService = existingMot
        ? await this.prisma.service.update({
            where: { id: existingMot.id },
            data: { name: mot.name, price: mot.price },
          })
        : await this.prisma.service.create({
            data: {
              garage_id: garageId,
              name: mot.name,
              price: mot.price,
              type: ServiceType.MOT,
            },
          });
    }

    // =========================
    // RETEST
    // =========================
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

      const existingRetest = await this.prisma.service.findFirst({
        where: { garage_id: garageId, type: ServiceType.RETEST },
      });

      retestService = existingRetest
        ? await this.prisma.service.update({
            where: { id: existingRetest.id },
            data: { name: retest.name, price: retest.price },
          })
        : await this.prisma.service.create({
            data: {
              garage_id: garageId,
              name: retest.name,
              price: retest.price,
              type: ServiceType.RETEST,
            },
          });
    }

    // =========================
    // ADDITIONAL (SKIP EXISTING, CREATE NEW)
    // =========================
    const additionalResults = [];

    if (additionals && Array.isArray(additionals)) {
      // 1️⃣ Request-level duplicate check
      const requestNames = new Set<string>();

      for (const add of additionals) {
        if (!add.name || !add.name.trim()) {
          throw new BadRequestException('Additional service name is required');
        }

        const normalized = add.name.trim().toLowerCase();
        if (requestNames.has(normalized)) {
          throw new BadRequestException(
            `Duplicate additional service name in request: ${add.name}`,
          );
        }
        requestNames.add(normalized);
      }

      // 2️⃣ Fetch existing additional services
      const dbAdditional = await this.prisma.service.findMany({
        where: { garage_id: garageId, type: ServiceType.ADDITIONAL },
      });

      const dbNames = new Set(
        dbAdditional.map((db) => db.name.trim().toLowerCase()),
      );

      // 3️⃣ Create only NEW services
      for (const add of additionals) {
        const normalized = add.name.trim().toLowerCase();

        // 🔹 Skip if already exists
        if (dbNames.has(normalized)) {
          additionalResults.push(
            dbAdditional.find((db) => db.name === add.name),
          );
          continue;
        }

        const created = await this.prisma.service.create({
          data: {
            garage_id: garageId,
            name: add.name,
            price: null,
            type: ServiceType.ADDITIONAL,
          },
        });

        additionalResults.push(created);
      }
    }

    // =========================
    // RESPONSE
    // =========================
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
