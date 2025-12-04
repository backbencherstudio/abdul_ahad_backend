/*
  Warnings:

  - You are about to drop the column `timeSlotId` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Order` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_timeSlotId_fkey";

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_userId_fkey";

-- DropIndex
DROP INDEX "Order_timeSlotId_key";

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "timeSlotId",
DROP COLUMN "userId";
