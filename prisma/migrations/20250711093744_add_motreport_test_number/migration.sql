-- AlterTable
ALTER TABLE "MotReport" ADD COLUMN     "defects" TEXT,
ADD COLUMN     "mileage" INTEGER,
ADD COLUMN     "mileage_unit" TEXT,
ADD COLUMN     "raw_data" TEXT,
ADD COLUMN     "test_number" TEXT,
ALTER COLUMN "expiry_date" DROP NOT NULL;
