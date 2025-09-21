import { Controller, Get, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { PaymentTransactionService } from './payment-transaction.service';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../../common/guard/role/roles.guard';
import { JwtAuthGuard } from '../../../modules/auth/guards/jwt-auth.guard';
import { Role } from '../../../common/guard/role/role.enum';
import { Roles } from '../../../common/guard/role/roles.decorator';
import { Request } from 'express';
import { AbilitiesGuard } from '../../../ability/abilities.guard';
import { CheckAbilities } from '../../../ability/abilities.decorator';
import { Action } from '../../../ability/ability.factory';

@ApiBearerAuth()
@ApiTags('Payment transaction')
@UseGuards(JwtAuthGuard, RolesGuard, AbilitiesGuard)
@Roles(Role.ADMIN)
@Controller('admin/payment-transaction')
export class PaymentTransactionController {
  constructor(
    private readonly paymentTransactionService: PaymentTransactionService,
  ) {}

  @ApiOperation({ summary: 'Get all packages' })
  @Get()
  @CheckAbilities({ action: Action.Read, subject: 'Payment' })
  async findAll(@Req() req: Request) {
    try {
      const user_id = req.user.userId;

      const paymentTransactions =
        await this.paymentTransactionService.findAll(user_id);

      return paymentTransactions;
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  @ApiOperation({ summary: 'Get one package' })
  @Get(':id')
  @CheckAbilities({ action: Action.Show, subject: 'Payment' })
  async findOne(@Req() req: Request, @Param('id') id: string) {
    try {
      const user_id = req.user.userId;

      const paymentTransaction = await this.paymentTransactionService.findOne(
        id,
        user_id,
      );

      return paymentTransaction;
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  @Delete(':id')
  @CheckAbilities({ action: Action.Delete, subject: 'Payment' })
  async remove(@Req() req: Request, @Param('id') id: string) {
    try {
      const user_id = req.user.userId;

      const paymentTransaction = await this.paymentTransactionService.remove(
        id,
        user_id,
      );

      return paymentTransaction;
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }
}
