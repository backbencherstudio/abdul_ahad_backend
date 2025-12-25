-- AlterTable
ALTER TABLE "schedules" ALTER COLUMN "start_time" DROP NOT NULL,
ALTER COLUMN "end_time" DROP NOT NULL,
ALTER COLUMN "slot_duration" DROP NOT NULL;
