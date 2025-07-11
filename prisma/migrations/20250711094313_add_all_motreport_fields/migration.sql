/*
  Warnings:

  - You are about to drop the column `mileage` on the `MotReport` table. All the data in the column will be lost.
  - You are about to drop the column `mileage_unit` on the `MotReport` table. All the data in the column will be lost.
  - You are about to drop the column `mot_pass_date` on the `MotReport` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `MotReport` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "MotReport" DROP COLUMN "mileage",
DROP COLUMN "mileage_unit",
DROP COLUMN "mot_pass_date",
DROP COLUMN "notes",
ADD COLUMN     "data_source" TEXT,
ADD COLUMN     "odometer_result_type" TEXT,
ADD COLUMN     "odometer_unit" TEXT,
ADD COLUMN     "odometer_value" INTEGER,
ADD COLUMN     "registration_at_test" TEXT,
ADD COLUMN     "test_date" TIMESTAMP(3),
ALTER COLUMN "status" DROP NOT NULL;
