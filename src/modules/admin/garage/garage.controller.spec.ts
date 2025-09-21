import { Test, TestingModule } from '@nestjs/testing';
import { GarageController } from './garage.controller';
import { GarageService } from './garage.service';

describe('GarageController', () => {
  let controller: GarageController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GarageController],
      providers: [GarageService],
    }).compile();

    controller = module.get<GarageController>(GarageController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
