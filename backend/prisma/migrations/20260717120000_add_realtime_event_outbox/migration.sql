CREATE TABLE "realtime_event_outbox" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "claim_token" TEXT,
    "claimed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "realtime_event_outbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "realtime_event_outbox_published_created_at_idx"
ON "realtime_event_outbox"("published_at", "created_at" ASC);

CREATE INDEX "realtime_event_outbox_claim_token_idx"
ON "realtime_event_outbox"("claim_token");
