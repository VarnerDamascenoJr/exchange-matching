-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "available_btc" DECIMAL(28,8) NOT NULL,
    "reserved_btc" DECIMAL(28,8) NOT NULL,
    "available_usd" DECIMAL(28,8) NOT NULL,
    "reserved_usd" DECIMAL(28,8) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wallets_available_btc_non_negative" CHECK ("available_btc" >= 0),
    CONSTRAINT "wallets_reserved_btc_non_negative" CHECK ("reserved_btc" >= 0),
    CONSTRAINT "wallets_available_usd_non_negative" CHECK ("available_usd" >= 0),
    CONSTRAINT "wallets_reserved_usd_non_negative" CHECK ("reserved_usd" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_key" ON "wallets"("user_id");

-- AddForeignKey
ALTER TABLE "wallets"
ADD CONSTRAINT "wallets_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
