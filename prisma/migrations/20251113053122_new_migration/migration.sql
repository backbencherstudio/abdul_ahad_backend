/*
  Warnings:

  - You are about to drop the column `date` on the `TimeSlot` table. All the data in the column will be lost.
  - You are about to drop the column `end_time` on the `TimeSlot` table. All the data in the column will be lost.
  - You are about to drop the column `start_time` on the `TimeSlot` table. All the data in the column will be lost.
  - You are about to drop the `calendars` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[timeSlotId]` on the table `Order` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[order_id]` on the table `TimeSlot` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[garage_id,start_datetime]` on the table `TimeSlot` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `end_datetime` to the `TimeSlot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `start_datetime` to the `TimeSlot` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "RestrictionType" AS ENUM ('HOLIDAY', 'BREAK');

-- CreateEnum
CREATE TYPE "ModificationType" AS ENUM ('MANUAL_BLOCK', 'BOOKED', 'TIME_MODIFIED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'CANCELLED', 'PAST_DUE');

-- CreateEnum
CREATE TYPE "MigrationJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_slot_id_fkey";

-- DropForeignKey
ALTER TABLE "calendars" DROP CONSTRAINT "calendars_garage_id_fkey";

-- DropForeignKey
ALTER TABLE "calendars" DROP CONSTRAINT "calendars_userId_fkey";

-- DropIndex
DROP INDEX "TimeSlot_garage_id_date_idx";

-- DropIndex
DROP INDEX "TimeSlot_garage_id_date_start_time_key";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "timeSlotId" TEXT;

-- AlterTable
ALTER TABLE "TimeSlot" DROP COLUMN "date",
DROP COLUMN "end_time",
DROP COLUMN "start_time",
ADD COLUMN     "end_datetime" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "modification_reason" TEXT,
ADD COLUMN     "modification_type" "ModificationType",
ADD COLUMN     "modified_by" TEXT,
ADD COLUMN     "scheduleId" TEXT,
ADD COLUMN     "start_datetime" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "has_subscription" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subscription_expires_at" TIMESTAMP(3);

-- DropTable
DROP TABLE "calendars";

-- DropEnum
DROP TYPE "CalendarEventType";

-- CreateTable
CREATE TABLE "schedules" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "garage_id" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "slot_duration" INTEGER NOT NULL DEFAULT 60,
    "restrictions" JSONB NOT NULL DEFAULT '[]',
    "daily_hours" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_pence" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "max_bookings_per_month" INTEGER NOT NULL,
    "max_vehicles" INTEGER NOT NULL,
    "priority_support" BOOLEAN NOT NULL DEFAULT false,
    "advanced_analytics" BOOLEAN NOT NULL DEFAULT false,
    "custom_branding" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "stripe_price_id" TEXT,
    "stripe_product_id" TEXT,
    "is_legacy_price" BOOLEAN NOT NULL DEFAULT false,
    "trial_period_days" INTEGER NOT NULL DEFAULT 14,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garage_subscriptions" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "garage_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "next_billing_date" TIMESTAMP(3),
    "cancel_at" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN DEFAULT false,
    "cancellation_reason" TEXT,
    "price_pence" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "stripe_subscription_id" TEXT,
    "stripe_customer_id" TEXT,
    "is_grandfathered" BOOLEAN NOT NULL DEFAULT false,
    "notice_sent_at" TIMESTAMP(3),
    "migration_scheduled_at" TIMESTAMP(3),
    "original_price_pence" INTEGER,

    CONSTRAINT "garage_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migration_jobs" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "plan_id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "status" "MigrationJobStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,

    CONSTRAINT "migration_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_attempts" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "job_id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "garage_id" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error_message" TEXT,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "retry_after" TIMESTAMP(3),

    CONSTRAINT "job_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "schedules_garage_id_key" ON "schedules"("garage_id");

-- CreateIndex
CREATE INDEX "schedules_garage_id_idx" ON "schedules"("garage_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_name_key" ON "subscription_plans"("name");

-- CreateIndex
CREATE INDEX "garage_subscriptions_garage_id_idx" ON "garage_subscriptions"("garage_id");

-- CreateIndex
CREATE INDEX "garage_subscriptions_plan_id_idx" ON "garage_subscriptions"("plan_id");

-- CreateIndex
CREATE INDEX "garage_subscriptions_status_idx" ON "garage_subscriptions"("status");

-- CreateIndex
CREATE INDEX "migration_jobs_plan_id_idx" ON "migration_jobs"("plan_id");

-- CreateIndex
CREATE INDEX "migration_jobs_status_idx" ON "migration_jobs"("status");

-- CreateIndex
CREATE INDEX "migration_jobs_job_type_idx" ON "migration_jobs"("job_type");

-- CreateIndex
CREATE INDEX "migration_jobs_created_at_idx" ON "migration_jobs"("created_at");

-- CreateIndex
CREATE INDEX "job_attempts_job_id_idx" ON "job_attempts"("job_id");

-- CreateIndex
CREATE INDEX "job_attempts_subscription_id_idx" ON "job_attempts"("subscription_id");

-- CreateIndex
CREATE INDEX "job_attempts_garage_id_idx" ON "job_attempts"("garage_id");

-- CreateIndex
CREATE INDEX "job_attempts_success_idx" ON "job_attempts"("success");

-- CreateIndex
CREATE UNIQUE INDEX "Order_timeSlotId_key" ON "Order"("timeSlotId");

-- CreateIndex
CREATE UNIQUE INDEX "TimeSlot_order_id_key" ON "TimeSlot"("order_id");

-- CreateIndex
CREATE INDEX "TimeSlot_garage_id_start_datetime_end_datetime_idx" ON "TimeSlot"("garage_id", "start_datetime", "end_datetime");

-- CreateIndex
CREATE UNIQUE INDEX "TimeSlot_garage_id_start_datetime_key" ON "TimeSlot"("garage_id", "start_datetime");

-- CreateIndex
CREATE INDEX "users_has_subscription_idx" ON "users"("has_subscription");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_timeSlotId_fkey" FOREIGN KEY ("timeSlotId") REFERENCES "TimeSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeSlot" ADD CONSTRAINT "TimeSlot_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_subscriptions" ADD CONSTRAINT "garage_subscriptions_garage_id_fkey" FOREIGN KEY ("garage_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garage_subscriptions" ADD CONSTRAINT "garage_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_attempts" ADD CONSTRAINT "job_attempts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "migration_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
