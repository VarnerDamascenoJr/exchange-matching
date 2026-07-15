-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM (
    'QUEUED',
    'OPEN',
    'PARTIALLY_FILLED',
    'FILLED',
    'CANCELLED',
    'REJECTED'
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "price" DECIMAL(28,8) NOT NULL,
    "original_amount" DECIMAL(28,8) NOT NULL,
    "remaining_amount" DECIMAL(28,8) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "orders_price_positive" CHECK ("price" > 0),
    CONSTRAINT "orders_original_amount_positive" CHECK ("original_amount" > 0),
    CONSTRAINT "orders_remaining_amount_non_negative" CHECK ("remaining_amount" >= 0),
    CONSTRAINT "orders_remaining_amount_not_greater_than_original" CHECK ("remaining_amount" <= "original_amount")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_sequence_key" ON "orders"("sequence");

-- CreateIndex
CREATE INDEX "orders_matching_sell_idx"
ON "orders"("side", "status", "price" ASC, "sequence" ASC);

-- CreateIndex
CREATE INDEX "orders_matching_buy_idx"
ON "orders"("side", "status", "price" DESC, "sequence" ASC);

-- CreateIndex
CREATE INDEX "orders_user_status_created_at_idx"
ON "orders"("user_id", "status", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "orders"
ADD CONSTRAINT "orders_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
