-- CreateTable
CREATE TABLE "protocol_registry" (
    "slug" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "chains" TEXT NOT NULL DEFAULT '[]',
    "tvl_usd" REAL,
    "vol_24h_usd" REAL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "protocol_connectors" (
    "slug" TEXT NOT NULL PRIMARY KEY,
    "discovery_method" TEXT NOT NULL,
    "factory_addresses" TEXT NOT NULL DEFAULT '{}',
    "factory_abi_id" TEXT NOT NULL,
    "subgraph_url" TEXT,
    "pool_type_hint" TEXT,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "protocol_connectors_slug_fkey" FOREIGN KEY ("slug") REFERENCES "protocol_registry" ("slug") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tokens" (
    "address" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "is_intermediate_allowed" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "pools" (
    "pool_id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "pool_type" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "token0" TEXT NOT NULL,
    "token1" TEXT NOT NULL,
    "fee_bps" INTEGER,
    "tick_spacing" INTEGER,
    "created_block" BIGINT,
    "created_tx" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "tvl_usd" REAL,
    "vol_24h_usd" REAL,
    "last_state_block" BIGINT,
    "last_state_at" DATETIME,
    CONSTRAINT "pools_slug_fkey" FOREIGN KEY ("slug") REFERENCES "protocol_registry" ("slug") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pools_token0_fkey" FOREIGN KEY ("token0") REFERENCES "tokens" ("address") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "pools_token1_fkey" FOREIGN KEY ("token1") REFERENCES "tokens" ("address") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pool_state_snapshots" (
    "pool_id" TEXT NOT NULL,
    "block_number" BIGINT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "state_json" TEXT NOT NULL,

    PRIMARY KEY ("pool_id", "block_number"),
    CONSTRAINT "pool_state_snapshots_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "pools" ("pool_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "rfq_baselines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfq_id" TEXT NOT NULL,
    "token_in" TEXT NOT NULL,
    "token_out" TEXT NOT NULL,
    "amount_in" TEXT NOT NULL,
    "baseline_amount_out" TEXT NOT NULL,
    "baseline_effective_price" REAL NOT NULL,
    "baseline_price_impact_bps" INTEGER NOT NULL,
    "baseline_block_number" TEXT NOT NULL,
    "baseline_timestamp" TEXT NOT NULL,
    "baseline_route_summary" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "rfq_performance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfq_id" TEXT NOT NULL,
    "maker_id" TEXT NOT NULL,
    "maker_amount_out" TEXT NOT NULL,
    "delta_vs_baseline_abs" TEXT NOT NULL,
    "delta_vs_baseline_pct" REAL NOT NULL,
    "won" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rfq_performance_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfq_baselines" ("rfq_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "pools_address_key" ON "pools"("address");

-- CreateIndex
CREATE INDEX "pools_token0_token1_idx" ON "pools"("token0", "token1");

-- CreateIndex
CREATE INDEX "pools_slug_idx" ON "pools"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_baselines_rfq_id_key" ON "rfq_baselines"("rfq_id");

-- CreateIndex
CREATE INDEX "rfq_baselines_token_in_token_out_idx" ON "rfq_baselines"("token_in", "token_out");

-- CreateIndex
CREATE INDEX "rfq_baselines_created_at_idx" ON "rfq_baselines"("created_at");

-- CreateIndex
CREATE INDEX "rfq_performance_rfq_id_idx" ON "rfq_performance"("rfq_id");

-- CreateIndex
CREATE INDEX "rfq_performance_maker_id_idx" ON "rfq_performance"("maker_id");

-- CreateIndex
CREATE INDEX "rfq_performance_won_idx" ON "rfq_performance"("won");

-- CreateIndex
CREATE INDEX "rfq_performance_created_at_idx" ON "rfq_performance"("created_at");
