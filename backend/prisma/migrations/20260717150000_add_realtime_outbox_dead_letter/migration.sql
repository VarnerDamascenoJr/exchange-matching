ALTER TABLE "realtime_event_outbox"
ADD COLUMN "dead_lettered_at" TIMESTAMP(3);

CREATE INDEX "realtime_event_outbox_dead_lettered_created_at_idx"
ON "realtime_event_outbox"("dead_lettered_at", "created_at" ASC);
