/*
  Warnings:

  - You are about to drop the column `defects` on the `MotReport` table. All the data in the column will be lost.
  - You are about to drop the column `raw_data` on the `MotReport` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "MotReport" DROP COLUMN "defects",
DROP COLUMN "raw_data";

-- CreateTable
CREATE TABLE "MotDefect" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mot_report_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "dangerous" BOOLEAN NOT NULL,

    CONSTRAINT "MotDefect_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MotDefect_mot_report_id_idx" ON "MotDefect"("mot_report_id");

-- CreateIndex
CREATE INDEX "MotDefect_dangerous_idx" ON "MotDefect"("dangerous");

-- CreateIndex
CREATE INDEX "MotReport_vehicle_id_idx" ON "MotReport"("vehicle_id");

-- CreateIndex
CREATE INDEX "MotReport_status_idx" ON "MotReport"("status");

-- CreateIndex
CREATE INDEX "MotReport_test_date_idx" ON "MotReport"("test_date");

-- AddForeignKey
ALTER TABLE "MotDefect" ADD CONSTRAINT "MotDefect_mot_report_id_fkey" FOREIGN KEY ("mot_report_id") REFERENCES "MotReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
