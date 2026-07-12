-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DENIED');

-- CreateTable
CREATE TABLE "order_comments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "CommentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedBy" TEXT,

    CONSTRAINT "order_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_comments_orderId_idx" ON "order_comments"("orderId");

-- CreateIndex
CREATE INDEX "order_comments_status_idx" ON "order_comments"("status");

-- CreateIndex
CREATE INDEX "order_comments_createdAt_idx" ON "order_comments"("createdAt");

-- AddForeignKey
ALTER TABLE "order_comments" ADD CONSTRAINT "order_comments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_comments" ADD CONSTRAINT "order_comments_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
