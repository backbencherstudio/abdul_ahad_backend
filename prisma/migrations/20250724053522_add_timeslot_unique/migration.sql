/*
  Warnings:

  - A unique constraint covering the columns `[garage_id,date,start_time]` on the table `TimeSlot` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "TimeSlot_garage_id_date_start_time_key" ON "TimeSlot"("garage_id", "date", "start_time");
