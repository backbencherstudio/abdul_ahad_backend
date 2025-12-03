-- AlterTable
ALTER TABLE "notification_events" ADD COLUMN     "actions" JSONB;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "is_action_taken" BOOLEAN NOT NULL DEFAULT false;
