-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_protocol_registry" (
    "slug" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'AMM',
    "chains" TEXT NOT NULL DEFAULT '[]',
    "tvl_usd" REAL,
    "vol_24h_usd" REAL,
    "defillama_slug" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_protocol_registry" ("category", "chains", "created_at", "name", "slug", "status", "tvl_usd", "updated_at", "vol_24h_usd") SELECT "category", "chains", "created_at", "name", "slug", "status", "tvl_usd", "updated_at", "vol_24h_usd" FROM "protocol_registry";
DROP TABLE "protocol_registry";
ALTER TABLE "new_protocol_registry" RENAME TO "protocol_registry";
CREATE INDEX "protocol_registry_kind_idx" ON "protocol_registry"("kind");
CREATE INDEX "protocol_registry_status_idx" ON "protocol_registry"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
