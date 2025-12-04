-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "TimeSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
