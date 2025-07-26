/*
  Warnings:

  - You are about to drop the `Calendar` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `garage_schedules` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Calendar" DROP CONSTRAINT "Calendar_garage_id_fkey";

-- DropForeignKey
ALTER TABLE "Calendar" DROP CONSTRAINT "Calendar_userId_fkey";

-- DropForeignKey
ALTER TABLE "garage_schedules" DROP CONSTRAINT "garage_schedules_garage_id_fkey";

-- DropTable
DROP TABLE "Calendar";

-- DropTable
DROP TABLE "garage_schedules";

-- CreateTable
CREATE TABLE "calendars" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "garage_id" TEXT NOT NULL,
    "event_date" TIMESTAMP(3) NOT NULL,
    "start_time" TEXT,
    "end_time" TEXT,
    "type" "CalendarEventType" NOT NULL,
    "description" TEXT,
    "slot_duration" INTEGER,
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "day_of_week" INTEGER,
    "userId" TEXT,

    CONSTRAINT "calendars_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendars_garage_id_event_date_idx" ON "calendars"("garage_id", "event_date");

-- CreateIndex
CREATE INDEX "calendars_garage_id_is_recurring_day_of_week_idx" ON "calendars"("garage_id", "is_recurring", "day_of_week");

-- AddForeignKey
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
