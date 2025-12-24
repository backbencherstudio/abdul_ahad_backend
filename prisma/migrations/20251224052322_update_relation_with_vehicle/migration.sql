-- DropForeignKey
ALTER TABLE "MotDefect" DROP CONSTRAINT "MotDefect_mot_report_id_fkey";

-- DropForeignKey
ALTER TABLE "MotReport" DROP CONSTRAINT "MotReport_vehicle_id_fkey";

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_vehicle_id_fkey";

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "vehicle_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "is_expired" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotReport" ADD CONSTRAINT "MotReport_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotDefect" ADD CONSTRAINT "MotDefect_mot_report_id_fkey" FOREIGN KEY ("mot_report_id") REFERENCES "MotReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
