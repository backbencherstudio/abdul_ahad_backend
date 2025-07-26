/*
  Warnings:

  - A unique constraint covering the columns `[garage_id,event_date,is_recurring]` on the table `calendars` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "calendars_garage_id_event_date_is_recurring_key" ON "calendars"("garage_id", "event_date", "is_recurring");
