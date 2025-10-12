-- DropIndex
DROP INDEX "order_items_product_lookup_idx";

-- DropIndex
DROP INDEX "orders_payment_status_idx";

-- DropIndex
DROP INDEX "orders_print_status_idx";

-- DropIndex
DROP INDEX "orders_province_idx";

-- DropIndex
DROP INDEX "orders_search_performance_idx";

-- DropIndex
DROP INDEX "orders_stats_idx";

-- DropIndex
DROP INDEX "product_variant_options_lookup_idx";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deletedDriverName" TEXT;
