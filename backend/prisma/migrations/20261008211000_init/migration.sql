-- CreateTable
CREATE TABLE "suppliers" (
    "id" SERIAL NOT NULL,
    "erp_client_id" VARCHAR(64),
    "erp_base_client_id" VARCHAR(64),
    "supplier_name" VARCHAR(255) NOT NULL,
    "client_num" VARCHAR(64),
    "contact" VARCHAR(128),
    "mobile" VARCHAR(64),
    "status" VARCHAR(8),
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "supplier_id" INTEGER,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "erp_goods_id" VARCHAR(64) NOT NULL,
    "erp_options_id" VARCHAR(64) NOT NULL DEFAULT '',
    "goods_num" VARCHAR(64),
    "goods_name" VARCHAR(255),
    "options_name" VARCHAR(255),
    "supplier_name" VARCHAR(255),
    "whole_price" DECIMAL(14,4),
    "purchase_price" DECIMAL(14,4),
    "base_units" VARCHAR(32),
    "conversion_number" DECIMAL(14,4),
    "raw" JSONB,
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "erp_orders_id" VARCHAR(64) NOT NULL,
    "erp_orders_num" VARCHAR(64) NOT NULL,
    "supplier_id" INTEGER,
    "supplier_name" VARCHAR(255),
    "client_name" VARCHAR(255),
    "client_num" VARCHAR(64),
    "status" VARCHAR(32),
    "status_name" VARCHAR(64),
    "pay_status" VARCHAR(32),
    "pay_status_name" VARCHAR(64),
    "consignee" VARCHAR(255),
    "consignee_contact" VARCHAR(128),
    "consignee_phone" VARCHAR(64),
    "consignee_address" TEXT,
    "discount_total" DECIMAL(14,4),
    "freight" DECIMAL(14,4),
    "erp_create_date" TIMESTAMPTZ(3),
    "erp_update_date" TIMESTAMPTZ(3),
    "raw" JSONB,
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "erp_orders_list_id" VARCHAR(64),
    "erp_goods_id" VARCHAR(64),
    "erp_options_id" VARCHAR(64),
    "goods_num" VARCHAR(64),
    "goods_name" VARCHAR(255),
    "options_name" VARCHAR(255),
    "supplier_name" VARCHAR(255),
    "orders_number" DECIMAL(14,4),
    "orders_price" DECIMAL(14,4),
    "actual_amount" DECIMAL(14,4),
    "base_units" VARCHAR(32),
    "conversion_number" DECIMAL(14,4),
    "raw" JSONB,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "supplier_id" INTEGER,
    "erp_ships_sn" VARCHAR(64),
    "shipped_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operator_id" INTEGER,
    "status" VARCHAR(16) NOT NULL DEFAULT 'receivedin',
    "consignment_no" VARCHAR(64),
    "consignment_name" VARCHAR(128),
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "raw" JSONB,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_items" (
    "id" SERIAL NOT NULL,
    "shipment_id" INTEGER NOT NULL,
    "order_item_id" INTEGER,
    "product_id" INTEGER,
    "erp_goods_id" VARCHAR(64),
    "erp_options_id" VARCHAR(64),
    "goods_num" VARCHAR(64),
    "goods_name" VARCHAR(255),
    "options_name" VARCHAR(255),
    "base_units" VARCHAR(32),
    "qty_shipped" DECIMAL(14,4) NOT NULL,
    "purchase_price" DECIMAL(14,4) NOT NULL,
    "amount_eur" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "shipment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" SERIAL NOT NULL,
    "type" VARCHAR(32),
    "status" VARCHAR(16),
    "message" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_watermark" (
    "key" VARCHAR(64) NOT NULL,
    "value" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_watermark_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(64) NOT NULL,
    "value" TEXT,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_supplier_name_key" ON "suppliers"("supplier_name");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_supplier_id_idx" ON "users"("supplier_id");

-- CreateIndex
CREATE INDEX "products_supplier_name_idx" ON "products"("supplier_name");

-- CreateIndex
CREATE UNIQUE INDEX "products_erp_goods_id_erp_options_id_key" ON "products"("erp_goods_id", "erp_options_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_erp_orders_id_key" ON "orders"("erp_orders_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_erp_orders_num_key" ON "orders"("erp_orders_num");

-- CreateIndex
CREATE INDEX "orders_supplier_id_idx" ON "orders"("supplier_id");

-- CreateIndex
CREATE INDEX "orders_erp_create_date_idx" ON "orders"("erp_create_date" DESC);

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "shipments_order_id_idx" ON "shipments"("order_id");

-- CreateIndex
CREATE INDEX "shipments_supplier_id_idx" ON "shipments"("supplier_id");

-- CreateIndex
CREATE INDEX "shipments_shipped_at_idx" ON "shipments"("shipped_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "shipments_order_id_key" ON "shipments"("order_id");

-- CreateIndex
CREATE INDEX "shipment_items_shipment_id_idx" ON "shipment_items"("shipment_id");

-- CreateIndex
CREATE INDEX "sync_logs_created_at_idx" ON "sync_logs"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

