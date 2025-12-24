import { Module } from '@nestjs/common';
import { ContactService } from './contact.service';
import { ContactController } from './contact.controller';
import { NotificationModule } from '../../admin/notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
