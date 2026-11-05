-- Test-only fault gates. Installed only in the isolated E2E database, then dropped.
-- @statement
CREATE TABLE pipeline_faults (
  subject_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  PRIMARY KEY (subject_id, stage)
);

-- @statement
CREATE FUNCTION pipeline_fail_trade() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pipeline_faults
    WHERE subject_id = NEW.taker_order_id AND stage = 'trade'
  ) THEN
    RAISE EXCEPTION 'Injected pipeline settlement failure';
  END IF;
  RETURN NEW;
END;
$$;
-- @statement
CREATE TRIGGER pipeline_trade_fault BEFORE INSERT ON trades
FOR EACH ROW EXECUTE FUNCTION pipeline_fail_trade();

-- @statement
CREATE FUNCTION pipeline_fail_outbox_ack() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pipeline_faults f JOIN orders o ON o.id = OLD.order_id
    WHERE f.stage = 'outbox-ack' AND f.subject_id = o.user_id
  ) THEN
    RAISE EXCEPTION 'Injected pipeline enqueue acknowledgement failure';
  END IF;
  RETURN OLD;
END;
$$;
-- @statement
CREATE TRIGGER pipeline_outbox_ack_fault BEFORE DELETE ON order_matching_outbox
FOR EACH ROW EXECUTE FUNCTION pipeline_fail_outbox_ack();

-- @statement
CREATE FUNCTION pipeline_hold_post_commit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.published_at IS NOT NULL AND OLD.published_at IS NULL
     AND current_setting('application_name') LIKE 'pipeline-worker-%'
     AND EXISTS (
       SELECT 1 FROM pipeline_faults
       WHERE subject_id = NEW.payload->>'orderId' AND stage = 'after-commit'
     ) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('pipeline:after-commit', 0));
  END IF;
  RETURN NEW;
END;
$$;
-- @statement
CREATE TRIGGER pipeline_post_commit_fault BEFORE UPDATE ON realtime_event_outbox
FOR EACH ROW EXECUTE FUNCTION pipeline_hold_post_commit();
