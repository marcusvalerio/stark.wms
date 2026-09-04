-- DropIndex
DROP INDEX "InventoryBalance_productId_locationId_lotId_key";

-- AlterTable
ALTER TABLE "ReplenishmentTask" ADD COLUMN     "lotId" TEXT;

-- CreateIndex
CREATE INDEX "InventoryBalance_productId_locationId_lotId_idx" ON "InventoryBalance"("productId", "locationId", "lotId");

-- AddForeignKey
ALTER TABLE "ReplenishmentTask" ADD CONSTRAINT "ReplenishmentTask_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Expression unique index: Postgres treats NULL as distinct from NULL, so a
-- plain UNIQUE(productId, locationId, lotId) would let two concurrent
-- first-writes for a non-lot-controlled product+location both succeed,
-- creating duplicate InventoryBalance rows that silently split the truth.
-- COALESCE(lotId, '') collapses "no lot" to one comparable value so the
-- natural key (productId, locationId, lot-or-none) is genuinely unique and
-- the application's create-then-catch-P2002 fallback in
-- inventory.engine.ts#getOrCreateBalance can rely on it.
CREATE UNIQUE INDEX "InventoryBalance_natural_key" ON "InventoryBalance" ("productId", "locationId", (COALESCE("lotId", '')));
