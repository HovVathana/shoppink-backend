-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('ADMIN', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "OrderState" AS ENUM ('PLACED', 'DELIVERING', 'RETURNED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'STAFF');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'STAFF',
    "permissions" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "quantity" INTEGER NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "delivery_price_for_pp" DOUBLE PRECISION NOT NULL,
    "delivery_price_for_province" DOUBLE PRECISION NOT NULL,
    "categoryId" TEXT,
    "imageUrl" TEXT,
    "sku" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "bannerText" TEXT,
    "bannerColor" TEXT DEFAULT 'blue',
    "bannerType" TEXT DEFAULT 'info',
    "originalPrice" DOUBLE PRECISION,
    "isOnSale" BOOLEAN NOT NULL DEFAULT false,
    "hasOptions" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_option_groups" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "selectionType" TEXT NOT NULL DEFAULT 'SINGLE',
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "parentGroupId" TEXT,
    "isParent" BOOLEAN NOT NULL DEFAULT false,
    "level" INTEGER NOT NULL DEFAULT 1,
    "path" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "affectsStock" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_option_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_options" (
    "id" TEXT NOT NULL,
    "optionGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceType" TEXT NOT NULL DEFAULT 'BASE',
    "priceValue" DOUBLE PRECISION,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "priceAdjustment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "optionPath" TEXT,
    "optionHash" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "minStock" INTEGER DEFAULT 0,
    "maxStock" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variant_options" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,

    CONSTRAINT "product_variant_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postalCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerLocation" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "remark" TEXT,
    "state" "OrderState" NOT NULL DEFAULT 'PLACED',
    "subtotalPrice" DOUBLE PRECISION NOT NULL,
    "companyDeliveryPrice" DOUBLE PRECISION NOT NULL,
    "deliveryPrice" DOUBLE PRECISION NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "isPrinted" BOOLEAN NOT NULL DEFAULT false,
    "driverId" TEXT,
    "createdBy" TEXT,
    "orderSource" "OrderSource" NOT NULL DEFAULT 'ADMIN',
    "paymentProofUrl" TEXT,
    "orderAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productOptionId" TEXT,
    "quantity" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "optionDetails" JSONB,
    "productVariantId" TEXT,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blacklisted_phones" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "rawPhone" TEXT NOT NULL,
    "reason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blacklisted_phones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_productId_name_key" ON "product_variants"("productId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_productId_optionHash_key" ON "product_variants"("productId", "optionHash");

-- CreateIndex
CREATE UNIQUE INDEX "product_variant_options_variantId_optionId_key" ON "product_variant_options"("variantId", "optionId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "blacklisted_phones_phone_key" ON "blacklisted_phones"("phone");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "product_option_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_optionGroupId_fkey" FOREIGN KEY ("optionGroupId") REFERENCES "product_option_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_options" ADD CONSTRAINT "product_variant_options_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant_options" ADD CONSTRAINT "product_variant_options_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "product_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productOptionId_fkey" FOREIGN KEY ("productOptionId") REFERENCES "product_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
