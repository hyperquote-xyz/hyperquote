-- CreateTable
CREATE TABLE "fills" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tx_hash" TEXT NOT NULL,
    "rfq_id" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taker" TEXT NOT NULL,
    "maker" TEXT NOT NULL,
    "token_in" TEXT NOT NULL,
    "token_out" TEXT NOT NULL,
    "amount_in" TEXT NOT NULL,
    "amount_out" TEXT NOT NULL,
    "amount_in_usd" REAL NOT NULL,
    "baseline_out" TEXT,
    "improvement_bps" INTEGER NOT NULL,
    "taker_points" REAL NOT NULL,
    "maker_points" REAL NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "fills_tx_hash_key" ON "fills"("tx_hash");

-- CreateIndex
CREATE INDEX "fills_taker_idx" ON "fills"("taker");

-- CreateIndex
CREATE INDEX "fills_maker_idx" ON "fills"("maker");

-- CreateIndex
CREATE INDEX "fills_timestamp_idx" ON "fills"("timestamp");
