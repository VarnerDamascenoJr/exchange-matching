CREATE TABLE "order_matching_outbox" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "claim_token" TEXT,
    "claimed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_matching_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_matching_outbox_order_id_key"
ON "order_matching_outbox"("order_id");

CREATE INDEX "order_matching_outbox_claimed_created_at_idx"
ON "order_matching_outbox"("claimed_at", "created_at" ASC);

ALTER TABLE "order_matching_outbox"
ADD CONSTRAINT "order_matching_outbox_order_id_fkey"
FOREIGN KEY ("order_id") REFERENCES "orders"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
