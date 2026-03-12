-- CreateTable
CREATE TABLE "feed_fills" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfq_id" TEXT,
    "tx_hash" TEXT NOT NULL,
    "filled_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "maker" TEXT NOT NULL,
    "taker" TEXT NOT NULL,
    "token_in" TEXT NOT NULL,
    "token_out" TEXT NOT NULL,
    "amount_in" TEXT,
    "amount_out" TEXT,
    "notional_usd" REAL,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "benchmark_source" TEXT,
    "benchmark_out" TEXT,
    "improvement_bps" INTEGER,
    "benchmark_available" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE UNIQUE INDEX "feed_fills_tx_hash_key" ON "feed_fills"("tx_hash");

-- CreateIndex
CREATE INDEX "feed_fills_maker_idx" ON "feed_fills"("maker");

-- CreateIndex
CREATE INDEX "feed_fills_taker_idx" ON "feed_fills"("taker");

-- CreateIndex
CREATE INDEX "feed_fills_filled_at_idx" ON "feed_fills"("filled_at");

-- CreateIndex
CREATE INDEX "feed_fills_maker_taker_idx" ON "feed_fills"("maker", "taker");
