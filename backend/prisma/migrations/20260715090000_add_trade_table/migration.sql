CREATE TABLE "trades" (
    "id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "maker_order_id" TEXT NOT NULL,
    "taker_order_id" TEXT NOT NULL,
    "buy_order_id" TEXT NOT NULL,
    "sell_order_id" TEXT NOT NULL,
    "taker_side" "OrderSide" NOT NULL,
    "price" DECIMAL(28,8) NOT NULL,
    "amount" DECIMAL(28,8) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "trades_price_positive" CHECK ("price" > 0),
    CONSTRAINT "trades_amount_positive" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "trades_sequence_key" ON "trades"("sequence");
CREATE INDEX "trades_maker_order_id_idx" ON "trades"("maker_order_id");
CREATE INDEX "trades_taker_order_id_idx" ON "trades"("taker_order_id");
CREATE INDEX "trades_buy_order_id_created_at_idx" ON "trades"("buy_order_id", "created_at" DESC);
CREATE INDEX "trades_sell_order_id_created_at_idx" ON "trades"("sell_order_id", "created_at" DESC);
CREATE INDEX "trades_created_at_sequence_idx" ON "trades"("created_at" DESC, "sequence" DESC);

ALTER TABLE "trades"
ADD CONSTRAINT "trades_maker_order_id_fkey"
FOREIGN KEY ("maker_order_id") REFERENCES "orders"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trades"
ADD CONSTRAINT "trades_taker_order_id_fkey"
FOREIGN KEY ("taker_order_id") REFERENCES "orders"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trades"
ADD CONSTRAINT "trades_buy_order_id_fkey"
FOREIGN KEY ("buy_order_id") REFERENCES "orders"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trades"
ADD CONSTRAINT "trades_sell_order_id_fkey"
FOREIGN KEY ("sell_order_id") REFERENCES "orders"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
