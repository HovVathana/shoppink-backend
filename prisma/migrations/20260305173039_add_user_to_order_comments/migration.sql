/*
  Warnings:

  - Added the required column `userId` to the `order_comments` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "order_comments" ADD COLUMN     "userId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "order_comments_userId_idx" ON "order_comments"("userId");

-- AddForeignKey
ALTER TABLE "order_comments" ADD CONSTRAINT "order_comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
