-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "secondCompanyDeliveryTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "secondCompanyDeliveryKhr" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "secondCompanyDeliveryUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;
