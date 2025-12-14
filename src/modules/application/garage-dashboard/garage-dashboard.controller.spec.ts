import { Test, TestingModule } from '@nestjs/testing';
import { GarageDashboardController } from './garage-dashboard.controller';

describe('GarageDashboardController', () => {
  let controller: GarageDashboardController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GarageDashboardController],
    }).compile();

    controller = module.get<GarageDashboardController>(
      GarageDashboardController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
