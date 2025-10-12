-- AlterTable
ALTER TABLE "users" ADD COLUMN "profilePicture" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "returnedAt" TIMESTAMP(3);
