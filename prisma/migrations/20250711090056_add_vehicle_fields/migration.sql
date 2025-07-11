-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "co2_emissions" INTEGER,
ADD COLUMN     "dvla_data" TEXT,
ADD COLUMN     "engine_capacity" INTEGER,
ADD COLUMN     "make" TEXT,
ADD COLUMN     "mot_data" TEXT,
ADD COLUMN     "mot_expiry_date" TIMESTAMP(3),
ADD COLUMN     "year_of_manufacture" INTEGER;
