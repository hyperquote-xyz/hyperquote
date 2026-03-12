-- CreateTable
CREATE TABLE "feed_rfqs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taker" TEXT NOT NULL,
    "token_in" TEXT NOT NULL,
    "token_out" TEXT NOT NULL,
    "token_in_json" TEXT NOT NULL,
    "token_out_json" TEXT NOT NULL,
    "kind" INTEGER NOT NULL DEFAULT 0,
    "amount_in" TEXT,
    "amount_out" TEXT,
    "expiry" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "quote_count" INTEGER NOT NULL DEFAULT 0,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "fill_tx_hash" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "feed_rfqs_status_idx" ON "feed_rfqs"("status");

-- CreateIndex
CREATE INDEX "feed_rfqs_created_at_idx" ON "feed_rfqs"("created_at");

-- CreateIndex
CREATE INDEX "feed_rfqs_taker_idx" ON "feed_rfqs"("taker");

-- CreateIndex
CREATE INDEX "feed_rfqs_expiry_idx" ON "feed_rfqs"("expiry");
