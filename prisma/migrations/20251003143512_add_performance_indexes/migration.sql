-- CreateIndex
CREATE INDEX "order_items_orderId_productId_idx" ON "order_items"("orderId", "productId");

-- CreateIndex
CREATE INDEX "order_items_productId_idx" ON "order_items"("productId");

-- CreateIndex
CREATE INDEX "orders_orderAt_state_idx" ON "orders"("orderAt", "state");

-- CreateIndex
CREATE INDEX "orders_createdAt_orderSource_idx" ON "orders"("createdAt", "orderSource");

-- CreateIndex
CREATE INDEX "orders_customerPhone_idx" ON "orders"("customerPhone");

-- CreateIndex
CREATE INDEX "orders_assignedAt_idx" ON "orders"("assignedAt");

-- CreateIndex
CREATE INDEX "orders_state_createdAt_idx" ON "orders"("state", "createdAt");

-- CreateIndex
CREATE INDEX "orders_driverId_idx" ON "orders"("driverId");

-- CreateIndex
CREATE INDEX "products_isActive_categoryId_idx" ON "products"("isActive", "categoryId");

-- CreateIndex
CREATE INDEX "products_quantity_idx" ON "products"("quantity");

-- CreateIndex
CREATE INDEX "products_isActive_idx" ON "products"("isActive");
