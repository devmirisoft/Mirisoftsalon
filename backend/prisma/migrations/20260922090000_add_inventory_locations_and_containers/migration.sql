-- CreateEnum
CREATE TYPE "InventoryLocation" AS ENUM ('WAREHOUSE', 'RETAIL', 'SERVICE');

-- CreateEnum
CREATE TYPE "ProductContainerStatus" AS ENUM ('OPEN', 'EMPTY', 'LOST', 'DAMAGED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProductStockMovementType" ADD VALUE 'TRANSFER';
ALTER TYPE "ProductStockMovementType" ADD VALUE 'OPEN_CONTAINER';
ALTER TYPE "ProductStockMovementType" ADD VALUE 'CONTAINER_CLOSED';
ALTER TYPE "ProductStockMovementType" ADD VALUE 'WASTAGE';
ALTER TYPE "ProductStockMovementType" ADD VALUE 'LOST';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "packSize" DECIMAL(10,2),
ADD COLUMN     "packUnit" "ProductUnit";

-- AlterTable
ALTER TABLE "ProductStockMovement" ADD COLUMN     "appointmentServiceId" TEXT,
ADD COLUMN     "containerId" TEXT,
ADD COLUMN     "expectedQuantity" DECIMAL(10,2),
ADD COLUMN     "location" "InventoryLocation",
ADD COLUMN     "receivedByStaffId" TEXT,
ADD COLUMN     "serviceId" TEXT,
ADD COLUMN     "staffId" TEXT,
ADD COLUMN     "toBranchId" TEXT,
ADD COLUMN     "toLocation" "InventoryLocation",
ADD COLUMN     "unit" "ProductUnit";

-- CreateTable
CREATE TABLE "ProductLocationStock" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "branchId" TEXT,
    "siteKey" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "location" "InventoryLocation" NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductLocationStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductContainer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "branchId" TEXT,
    "productId" TEXT NOT NULL,
    "location" "InventoryLocation" NOT NULL DEFAULT 'SERVICE',
    "originalQuantity" DECIMAL(10,2) NOT NULL,
    "remainingQuantity" DECIMAL(10,2) NOT NULL,
    "unit" "ProductUnit" NOT NULL,
    "status" "ProductContainerStatus" NOT NULL DEFAULT 'OPEN',
    "openedByStaffId" TEXT,
    "openedById" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductContainer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductLocationStock_salonId_idx" ON "ProductLocationStock"("salonId");

-- CreateIndex
CREATE INDEX "ProductLocationStock_branchId_idx" ON "ProductLocationStock"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductLocationStock_productId_siteKey_location_key" ON "ProductLocationStock"("productId", "siteKey", "location");

-- CreateIndex
CREATE INDEX "ProductContainer_salonId_idx" ON "ProductContainer"("salonId");

-- CreateIndex
CREATE INDEX "ProductContainer_branchId_idx" ON "ProductContainer"("branchId");

-- CreateIndex
CREATE INDEX "ProductContainer_productId_status_idx" ON "ProductContainer"("productId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductContainer_productId_code_key" ON "ProductContainer"("productId", "code");

-- CreateIndex
CREATE INDEX "ProductStockMovement_containerId_idx" ON "ProductStockMovement"("containerId");

-- CreateIndex
CREATE INDEX "ProductStockMovement_appointmentServiceId_idx" ON "ProductStockMovement"("appointmentServiceId");

-- CreateIndex
CREATE INDEX "ProductStockMovement_productId_type_createdAt_idx" ON "ProductStockMovement"("productId", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductStockMovement" ADD CONSTRAINT "ProductStockMovement_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "ProductContainer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStockMovement" ADD CONSTRAINT "ProductStockMovement_appointmentServiceId_fkey" FOREIGN KEY ("appointmentServiceId") REFERENCES "AppointmentService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStockMovement" ADD CONSTRAINT "ProductStockMovement_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStockMovement" ADD CONSTRAINT "ProductStockMovement_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductStockMovement" ADD CONSTRAINT "ProductStockMovement_receivedByStaffId_fkey" FOREIGN KEY ("receivedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductLocationStock" ADD CONSTRAINT "ProductLocationStock_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductLocationStock" ADD CONSTRAINT "ProductLocationStock_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductLocationStock" ADD CONSTRAINT "ProductLocationStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductContainer" ADD CONSTRAINT "ProductContainer_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductContainer" ADD CONSTRAINT "ProductContainer_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductContainer" ADD CONSTRAINT "ProductContainer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductContainer" ADD CONSTRAINT "ProductContainer_openedByStaffId_fkey" FOREIGN KEY ("openedByStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductContainer" ADD CONSTRAINT "ProductContainer_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: stock recorded before locations existed is booked where the
-- product is used today, in the product's own branch (salon level for a
-- salon-wide product): retail products on the retail shelf, service-only
-- products in the service area, everything else in the warehouse. The total
-- per product is unchanged, so Product.currentStock still equals the sum.
INSERT INTO "ProductLocationStock" ("id", "salonId", "branchId", "siteKey", "productId", "location", "quantity", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  p."salonId",
  p."branchId",
  COALESCE(p."branchId", 'SALON'),
  p."id",
  (CASE
    WHEN p."isRetailProduct" THEN 'RETAIL'
    WHEN p."isServiceConsumable" THEN 'SERVICE'
    ELSE 'WAREHOUSE'
  END)::"InventoryLocation",
  p."currentStock",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Product" p
WHERE p."currentStock" <> 0;
