import { Injectable } from '@nestjs/common';
import { CreateContactDto } from './dto/create-contact.dto';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from 'src/mail/mail.service';
import { NotificationService } from '../../admin/notification/notification.service';

@Injectable()
export class ContactService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
    private notificationService: NotificationService,
  ) {}

  async create(createContactDto: CreateContactDto) {
    try {
      const contact = await this.prisma.contact.create({
        data: createContactDto,
      });

      // 1. Notify Admins via In-app Notification
      await this.notificationService.sendToAllAdmins({
        type: 'CONTACT_FORM',
        title: 'New Contact Submission',
        message: `New contact submission from ${createContactDto.name} (${createContactDto.email})`,
        entityId: contact.id,
        metadata: {
          name: createContactDto.name,
          email: createContactDto.email,
          phone: createContactDto.phone_number,
          message: createContactDto.message,
        },
      });

      // 2. Notify Admins via Email
      const admins = await this.prisma.user.findMany({
        where: {
          type: 'ADMIN',
          status: 1,
        },
        select: { email: true },
      });

      for (const admin of admins) {
        await this.mailService.sendContactFormSubmission({
          to: admin.email,
          contact_name: createContactDto.name,
          contact_email: createContactDto.email,
          contact_phone: createContactDto.phone_number,
          contact_message: createContactDto.message,
        });
      }

      return {
        success: true,
        message: 'Submitted successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }
}
