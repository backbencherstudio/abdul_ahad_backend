import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class TransactionRepository {
  private static mapStatus(input?: string): string {
    const s = (input || '').toLowerCase();
    switch (s) {
      case 'succeeded':
      case 'paid':
        return 'PAID';
      case 'failed':
        return 'FAILED';
      case 'canceled':
      case 'cancelled':
        return 'FAILED';
      case 'requires_action':
      case 'processing':
      case 'pending':
        return 'PENDING';
      case 'refunded':
      case 'refund':
        return 'REFUNDED';
      default:
        return 'PENDING';
    }
  }
  /**
   * Create transaction
   * @returns
   */
  static async createTransaction({
    booking_id,
    amount,
    currency,
    reference_number,
    status = 'pending',
  }: {
    booking_id: string;
    amount?: number;
    currency?: string;
    reference_number?: string;
    status?: string;
  }) {
    const data: any = {};
    if (booking_id) {
      data['booking_id'] = booking_id;
    }
    if (amount) {
      data['amount'] = Number(amount);
    }
    if (currency) {
      data['currency'] = currency;
    }
    if (reference_number) {
      data['reference_number'] = reference_number;
    }
    if (status) {
      data['status'] = this.mapStatus(status);
    }
    return await prisma.paymentTransaction.create({
      data: {
        ...data,
      },
    });
  }

  /**
   * Update transaction
   * @returns
   */
  static async updateTransaction({
    reference_number,
    status = 'pending',
    paid_amount,
    paid_currency,
    raw_status,
  }: {
    reference_number: string;
    status: string;
    paid_amount?: number;
    paid_currency?: string;
    raw_status?: string;
  }) {
    const data: any = {};
    const order_data: any = {};
    if (status) {
      const mapped = this.mapStatus(status);
      data['status'] = mapped;
      order_data['payment_status'] = mapped;
    }
    if (paid_amount) {
      data['paid_amount'] = Number(paid_amount);
      order_data['paid_amount'] = Number(paid_amount);
    }
    if (paid_currency) {
      data['paid_currency'] = paid_currency;
      order_data['paid_currency'] = paid_currency;
    }
    if (raw_status) {
      data['raw_status'] = raw_status;
      order_data['payment_raw_status'] = raw_status;
    }

    const paymentTransaction = await prisma.paymentTransaction.findMany({
      where: {
        reference_number: reference_number,
      },
    });

    // update booking status
    // if (paymentTransaction.length > 0) {
    //   await prisma.order.update({
    //     where: {
    //       id: paymentTransaction[0].order_id,
    //     },
    //     data: {
    //       ...order_data,
    //     },
    //   });
    // }

    return await prisma.paymentTransaction.updateMany({
      where: {
        reference_number: reference_number,
      },
      data: {
        ...data,
      },
    });
  }
}
