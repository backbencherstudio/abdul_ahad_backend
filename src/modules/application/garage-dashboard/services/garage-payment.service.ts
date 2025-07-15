import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';

@Injectable()
export class GaragePaymentService {
  private readonly logger = new Logger(GaragePaymentService.name);

  constructor(private prisma: PrismaService) {}

  async getPayments(userId: string) {
    // TODO: Implement in Chapter 5
    return {
      success: true,
      message: 'Payments retrieved successfully',
      data: [],
    };
  }

  async getPayment(userId: string, paymentId: string) {
    // TODO: Implement in Chapter 5
    return {
      success: true,
      message: 'Payment retrieved successfully',
      data: {},
    };
  }
}
