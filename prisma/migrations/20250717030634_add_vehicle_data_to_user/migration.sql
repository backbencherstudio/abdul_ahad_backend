-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_booking_date" TIMESTAMP(3),
ADD COLUMN     "last_mot_date" TIMESTAMP(3),
ADD COLUMN     "last_mot_expiry_date" TIMESTAMP(3),
ADD COLUMN     "vehicle_make" TEXT,
ADD COLUMN     "vehicle_model" TEXT,
ADD COLUMN     "vehicle_registration_number" TEXT;
