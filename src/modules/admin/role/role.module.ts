import { Module } from '@nestjs/common';
import { AbilityModule } from 'src/ability/ability.module';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';

@Module({
  imports: [AbilityModule],
  controllers: [RoleController],
  providers: [RoleService],
  exports: [RoleService],
})
export class RoleModule {}
