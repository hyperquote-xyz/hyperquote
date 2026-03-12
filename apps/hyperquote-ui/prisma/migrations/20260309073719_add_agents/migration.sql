-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "api_key_hash" TEXT NOT NULL,
    "api_key_prefix" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "roles" TEXT NOT NULL DEFAULT '["monitor"]',
    "rate_limit_per_min" INTEGER NOT NULL DEFAULT 60,
    "rate_limit_per_hour" INTEGER NOT NULL DEFAULT 1000,
    "description" TEXT,
    "webhook_url" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "last_seen_at" DATETIME
);

-- CreateTable
CREATE TABLE "agent_activity_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agent_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "rfq_id" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "ip_address" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_activity_logs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "agents_api_key_hash_key" ON "agents"("api_key_hash");

-- CreateIndex
CREATE INDEX "agents_owner_idx" ON "agents"("owner");

-- CreateIndex
CREATE INDEX "agents_wallet_idx" ON "agents"("wallet");

-- CreateIndex
CREATE INDEX "agents_status_idx" ON "agents"("status");

-- CreateIndex
CREATE INDEX "agent_activity_logs_agent_id_idx" ON "agent_activity_logs"("agent_id");

-- CreateIndex
CREATE INDEX "agent_activity_logs_action_idx" ON "agent_activity_logs"("action");

-- CreateIndex
CREATE INDEX "agent_activity_logs_timestamp_idx" ON "agent_activity_logs"("timestamp");
