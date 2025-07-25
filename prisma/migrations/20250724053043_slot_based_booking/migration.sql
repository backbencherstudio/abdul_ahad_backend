/*
  Warnings:

  - A unique constraint covering the columns `[slot_id]` on the table `Order` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "slot_id" TEXT;

-- AlterTable
ALTER TABLE "garage_schedules" ADD COLUMN     "slot_duration" INTEGER;

-- CreateTable
CREATE TABLE "TimeSlot" (
    "id" TEXT NOT NULL,
    "garage_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "order_id" TEXT,
    "userId" TEXT,

    CONSTRAINT "TimeSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeSlot_garage_id_date_idx" ON "TimeSlot"("garage_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Order_slot_id_key" ON "Order"("slot_id");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "TimeSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeSlot" ADD CONSTRAINT "TimeSlot_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeSlot" ADD CONSTRAINT "TimeSlot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
