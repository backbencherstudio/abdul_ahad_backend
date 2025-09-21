import { Command, CommandRunner } from 'nest-commander';
import { PrismaService } from '../prisma/prisma.service';

@Command({ name: 'reset', description: 'Reset database and clear all data' })
export class ResetCommand extends CommandRunner {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async run(passedParam: string[]): Promise<void> {
    await this.reset(passedParam);
  }

  async reset(param: string[]) {
    try {
      console.log(`Prisma Env: ${process.env.PRISMA_ENV}`);
      console.log('�� Database reset started...');

      // Begin transaction for safety
      await this.prisma.$transaction(async ($tx) => {
        // Delete in reverse order of dependencies
        console.log('🗑️  Clearing permission roles...');
        await $tx.permissionRole.deleteMany();

        console.log('🗑️  Clearing role users...');
        await $tx.roleUser.deleteMany();

        console.log('🗑️  Clearing permissions...');
        await $tx.permission.deleteMany();

        console.log('🗑️  Clearing roles...');
        await $tx.role.deleteMany();

        console.log('🗑️  Clearing users...');
        await $tx.user.deleteMany();

        // Clear other tables if they exist
        console.log('��️  Clearing other data...');
        await $tx.account.deleteMany();
        await $tx.ucode.deleteMany();
        await $tx.notification.deleteMany();
        await $tx.notificationEvent.deleteMany();
        await $tx.userPaymentMethod.deleteMany();
        await $tx.paymentTransaction.deleteMany();
        await $tx.message.deleteMany();
        await $tx.attachment.deleteMany();
        await $tx.conversation.deleteMany();
        await $tx.faq.deleteMany();
        await $tx.contact.deleteMany();
        await $tx.socialMedia.deleteMany();
        await $tx.websiteInfo.deleteMany();
        await $tx.setting.deleteMany();
        await $tx.userSetting.deleteMany();

        // Clear MOT-related tables
        await $tx.motDefect.deleteMany();
        await $tx.motReport.deleteMany();
        await $tx.vehicle.deleteMany();
        await $tx.orderItem.deleteMany();
        await $tx.order.deleteMany();
        await $tx.service.deleteMany();
        await $tx.invoice.deleteMany();

        // Clear schedule and time slots
        await $tx.timeSlot.deleteMany();
        await $tx.schedule.deleteMany();

        // Clear subscription data
        await $tx.garageSubscription.deleteMany();
        await $tx.subscriptionPlan.deleteMany();
      });

      console.log('✅ Database reset completed successfully!');
      console.log('�� You can now run "yarn seed" to populate fresh data.');
    } catch (error) {
      console.error('❌ Database reset failed:', error);
      throw error;
    }
  }
}
