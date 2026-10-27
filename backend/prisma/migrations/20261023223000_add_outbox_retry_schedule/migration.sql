ALTER TABLE "order_matching_outbox"
ADD COLUMN "next_attempt_at" TIMESTAMP(3);

ALTER TABLE "realtime_event_outbox"
ADD COLUMN "next_attempt_at" TIMESTAMP(3);

CREATE INDEX "order_matching_outbox_next_attempt_created_at_idx"
ON "order_matching_outbox"("next_attempt_at", "created_at");

CREATE INDEX "realtime_event_outbox_next_attempt_created_at_idx"
ON "realtime_event_outbox"("next_attempt_at", "created_at");
