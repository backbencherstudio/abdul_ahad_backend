-- AlterTable
ALTER TABLE "contacts" DROP COLUMN "first_name",
DROP COLUMN "last_name",
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "user_id" TEXT,
ALTER COLUMN "email" SET NOT NULL,
ALTER COLUMN "message" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
