// external imports
import { Module } from '@nestjs/common';
import { CommandFactory } from 'nest-commander';
// internal imports
import { PrismaService } from './prisma/prisma.service';
import { SeedCommand } from './command/seed.command';
import { ResetCommand } from './command/reset.command';

@Module({
  providers: [SeedCommand, PrismaService, ResetCommand],
})
export class AppModule {}

async function bootstrap() {
  await CommandFactory.run(AppModule);
}

bootstrap();
