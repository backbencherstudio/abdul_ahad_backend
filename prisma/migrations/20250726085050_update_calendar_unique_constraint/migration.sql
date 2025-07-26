/*
  Warnings:

  - A unique constraint covering the columns `[garage_id,event_date,is_recurring,day_of_week]` on the table `calendars` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "calendars_garage_id_event_date_is_recurring_key";

-- CreateIndex
CREATE UNIQUE INDEX "calendars_garage_id_event_date_is_recurring_day_of_week_key" ON "calendars"("garage_id", "event_date", "is_recurring", "day_of_week");
