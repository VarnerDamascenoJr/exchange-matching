-- Operator recovery after confirmed Redis job loss. Review pending orders and
-- retained failed jobs first; see docs/matching-recovery.md. Repeat in batches.
WITH pending AS (
  SELECT o.id
  FROM orders o
  WHERE o.status = 'QUEUED'
    AND NOT EXISTS (
      SELECT 1 FROM order_matching_outbox outbox WHERE outbox.order_id = o.id
    )
  ORDER BY o.sequence ASC
  LIMIT 100
  FOR UPDATE SKIP LOCKED
)
INSERT INTO order_matching_outbox (id, order_id, created_at)
SELECT 'recover_' || id, id, NOW() FROM pending
ON CONFLICT (order_id) DO NOTHING;
