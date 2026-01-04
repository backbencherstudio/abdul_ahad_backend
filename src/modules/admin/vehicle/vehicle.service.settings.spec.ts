import { Test, TestingModule } from '@nestjs/testing';
import { VehicleService } from './vehicle.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('VehicleService (Reminder Settings)', () => {
  let service: VehicleService;
  let prisma: PrismaService;

  const mockPrismaService = {
    setting: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VehicleService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<VehicleService>(VehicleService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getMotReminderSettings', () => {
    it('should return default values when settings are not found', async () => {
      mockPrismaService.setting.findUnique.mockResolvedValue(null);

      const result = await service.getMotReminderSettings();

      expect(result.success).toBe(true);
      expect(result.data.reminderPeriods).toEqual([7]);
      expect(result.data.autoReminder).toBe(false);
      expect(result.data.reminderMessage).toContain('{make}');
    });

    it('should return stored settings when found', async () => {
      mockPrismaService.setting.findUnique.mockImplementation(({ where }) => {
        if (where.key === 'MOT_REMINDER_PERIODS')
          return Promise.resolve({ default_value: '15,7,1' });
        if (where.key === 'MOT_REMINDER_ACTIVE')
          return Promise.resolve({ default_value: 'true' });
        if (where.key === 'MOT_REMINDER_MESSAGE')
          return Promise.resolve({
            default_value: 'Custom message for {registration}',
          });
        return Promise.resolve(null);
      });

      const result = await service.getMotReminderSettings();

      expect(result.success).toBe(true);
      expect(result.data.reminderPeriods).toEqual([15, 7, 1]);
      expect(result.data.autoReminder).toBe(true);
      expect(result.data.reminderMessage).toBe(
        'Custom message for {registration}',
      );
    });
  });

  describe('updateMotReminderSettings', () => {
    it('should upsert all settings', async () => {
      const dto = {
        reminderPeriods: [30, 15],
        autoReminder: true,
        reminderMessage: 'Hello {make}',
      };

      mockPrismaService.setting.upsert.mockResolvedValue({});

      const result = await service.updateMotReminderSettings(dto);

      expect(result.success).toBe(true);
      expect(mockPrismaService.setting.upsert).toHaveBeenCalledTimes(3);

      // Check for message upsert specifically
      expect(mockPrismaService.setting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'MOT_REMINDER_MESSAGE' },
          create: expect.objectContaining({ default_value: 'Hello {make}' }),
        }),
      );
    });
  });
});
