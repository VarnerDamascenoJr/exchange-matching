-- Enforce that every persisted user must have a wallet by commit time.
CREATE OR REPLACE FUNCTION enforce_user_has_wallet()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "wallets"
        WHERE "user_id" = NEW."id"
    ) THEN
        RAISE EXCEPTION 'User % must have a wallet', NEW."id";
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "users_must_have_wallet_trigger"
AFTER INSERT OR UPDATE ON "users"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_user_has_wallet();

-- Prevent wallet deletes or reassignments that would leave an existing user orphaned.
CREATE OR REPLACE FUNCTION prevent_user_without_wallet()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "users"
        WHERE "id" = OLD."user_id"
    ) AND NOT EXISTS (
        SELECT 1
        FROM "wallets"
        WHERE "user_id" = OLD."user_id"
    ) THEN
        RAISE EXCEPTION 'User % must have a wallet', OLD."user_id";
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "wallets_cannot_orphan_users_trigger"
AFTER DELETE OR UPDATE OF "user_id" ON "wallets"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION prevent_user_without_wallet();

-- Keep order lifecycle states aligned with remaining_amount semantics.
ALTER TABLE "orders"
ADD CONSTRAINT "orders_status_remaining_amount_consistency"
CHECK (
    ("status" = 'QUEUED' AND "remaining_amount" = "original_amount")
    OR ("status" = 'OPEN' AND "remaining_amount" = "original_amount")
    OR (
        "status" = 'PARTIALLY_FILLED'
        AND "remaining_amount" > 0
        AND "remaining_amount" < "original_amount"
    )
    OR ("status" = 'FILLED' AND "remaining_amount" = 0)
    OR (
        "status" = 'CANCELLED'
        AND "remaining_amount" > 0
        AND "remaining_amount" <= "original_amount"
    )
    OR ("status" = 'REJECTED' AND "remaining_amount" = "original_amount")
);
