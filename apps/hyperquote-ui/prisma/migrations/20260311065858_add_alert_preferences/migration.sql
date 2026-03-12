-- CreateTable
CREATE TABLE "alert_preferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agent_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "tokens" TEXT NOT NULL DEFAULT '[]',
    "min_notional_usd" REAL NOT NULL DEFAULT 0,
    "visibility" TEXT NOT NULL DEFAULT 'all',
    "side" TEXT NOT NULL DEFAULT 'all',
    "event_types" TEXT NOT NULL DEFAULT '["rfq.created","rfq.filled"]',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "alert_preferences_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "alert_preferences_agent_id_key" ON "alert_preferences"("agent_id");
