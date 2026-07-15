CREATE TYPE "TradeFeeAsset" AS ENUM ('BTC', 'USD');

ALTER TABLE "trades"
ADD COLUMN "maker_fee_rate" DECIMAL(10,8) NOT NULL DEFAULT 0,
ADD COLUMN "maker_fee_amount" DECIMAL(28,8) NOT NULL DEFAULT 0,
ADD COLUMN "maker_fee_asset" "TradeFeeAsset" NOT NULL DEFAULT 'USD',
ADD COLUMN "taker_fee_rate" DECIMAL(10,8) NOT NULL DEFAULT 0,
ADD COLUMN "taker_fee_amount" DECIMAL(28,8) NOT NULL DEFAULT 0,
ADD COLUMN "taker_fee_asset" "TradeFeeAsset" NOT NULL DEFAULT 'BTC';

ALTER TABLE "trades"
ADD CONSTRAINT "trades_maker_fee_rate_non_negative" CHECK ("maker_fee_rate" >= 0),
ADD CONSTRAINT "trades_maker_fee_amount_non_negative" CHECK ("maker_fee_amount" >= 0),
ADD CONSTRAINT "trades_taker_fee_rate_non_negative" CHECK ("taker_fee_rate" >= 0),
ADD CONSTRAINT "trades_taker_fee_amount_non_negative" CHECK ("taker_fee_amount" >= 0);
