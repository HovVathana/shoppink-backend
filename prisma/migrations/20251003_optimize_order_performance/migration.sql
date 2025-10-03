-- Add additional performance indexes for order operations
-- These indexes target the most common query patterns identified in the codebase

-- Composite index for order listing with search and pagination
CREATE INDEX IF NOT EXISTS "orders_search_performance_idx" ON "orders"("orderSource", "state", "orderAt" DESC);

-- Index for customer order queries with date filtering
CREATE INDEX IF NOT EXISTS "orders_customer_date_idx" ON "orders"("orderSource", "orderAt" DESC) WHERE "orderSource" = 'CUSTOMER';

-- Index for admin order queries with date filtering  
CREATE INDEX IF NOT EXISTS "orders_admin_date_idx" ON "orders"("orderSource", "orderAt" DESC) WHERE "orderSource" = 'ADMIN';

-- Composite index for assigned orders filtering
CREATE INDEX IF NOT EXISTS "orders_assigned_performance_idx" ON "orders"("assignedAt", "orderAt" DESC) WHERE "assignedAt" IS NOT NULL;

-- Index for order search operations (customer name, phone, location)
CREATE INDEX IF NOT EXISTS "orders_customer_name_search_idx" ON "orders" USING gin(to_tsvector('english', "customerName"));
CREATE INDEX IF NOT EXISTS "orders_customer_phone_search_idx" ON "orders"("customerPhone") WHERE "customerPhone" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "orders_customer_location_search_idx" ON "orders" USING gin(to_tsvector('english', "customerLocation"));

-- Index for province-based queries
CREATE INDEX IF NOT EXISTS "orders_province_idx" ON "orders"("province", "orderAt" DESC);

-- Optimize order items queries
CREATE INDEX IF NOT EXISTS "order_items_product_lookup_idx" ON "order_items"("productId", "orderId");

-- Optimize product variant queries (for order creation)
CREATE INDEX IF NOT EXISTS "product_variants_lookup_idx" ON "product_variants"("productId", "isActive") WHERE "isActive" = true;
CREATE INDEX IF NOT EXISTS "product_variant_options_lookup_idx" ON "product_variant_options"("optionId", "variantId");

-- Index for product stock queries
CREATE INDEX IF NOT EXISTS "products_stock_check_idx" ON "products"("id", "quantity", "isActive") WHERE "isActive" = true;

-- Optimize driver assignment queries
CREATE INDEX IF NOT EXISTS "drivers_active_idx" ON "drivers"("isActive", "name") WHERE "isActive" = true;

-- Index for payment proof queries
CREATE INDEX IF NOT EXISTS "orders_payment_status_idx" ON "orders"("isPaid", "paymentProofUrl", "orderAt" DESC);

-- Index for print status queries
CREATE INDEX IF NOT EXISTS "orders_print_status_idx" ON "orders"("isPrinted", "orderAt" DESC);

-- Composite index for dashboard statistics
CREATE INDEX IF NOT EXISTS "orders_stats_idx" ON "orders"("state", "orderSource", "orderAt");

-- Index for duplicate phone detection
CREATE INDEX IF NOT EXISTS "orders_phone_duplicates_idx" ON "orders"("customerPhone", "orderAt" DESC) WHERE "customerPhone" IS NOT NULL;