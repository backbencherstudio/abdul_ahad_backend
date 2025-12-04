import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { ContactService } from './contact.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';

@ApiTags('Contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @ApiOperation({ summary: 'Create contact' })
  @Post()
  async createWithAuth(@Body() createContactDto: CreateContactDto) {
    try {
      const contact = await this.contactService.create(createContactDto);
      return contact;
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }
  @ApiOperation({ summary: 'Create contact' })
  @UseGuards(JwtAuthGuard)
  @Post('with-auth')
  async create(
    @Req() req: Request,
    @Body() createContactDto: CreateContactDto,
  ) {
    try {
      const contact = await this.contactService.create({
        ...createContactDto,
        user_id: req.user.userId,
      });
      return contact;
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }
}
