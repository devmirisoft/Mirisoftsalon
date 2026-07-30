-- CreateEnum
CREATE TYPE "ServicePackageType" AS ENUM ('STANDARD', 'CUSTOMER_CUSTOM');

-- AlterTable
ALTER TABLE "ServicePackage" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "sourceCustomerId" TEXT,
ADD COLUMN     "sourcePackageId" TEXT,
ADD COLUMN     "type" "ServicePackageType" NOT NULL DEFAULT 'STANDARD';

-- CreateIndex
CREATE INDEX "ServicePackage_type_idx" ON "ServicePackage"("type");

-- CreateIndex
CREATE INDEX "ServicePackage_customerId_idx" ON "ServicePackage"("customerId");

-- CreateIndex
CREATE INDEX "ServicePackage_sourceCustomerId_idx" ON "ServicePackage"("sourceCustomerId");

-- CreateIndex
CREATE INDEX "ServicePackage_sourcePackageId_idx" ON "ServicePackage"("sourcePackageId");

-- AddForeignKey
ALTER TABLE "ServicePackage" ADD CONSTRAINT "ServicePackage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePackage" ADD CONSTRAINT "ServicePackage_sourceCustomerId_fkey" FOREIGN KEY ("sourceCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePackage" ADD CONSTRAINT "ServicePackage_sourcePackageId_fkey" FOREIGN KEY ("sourcePackageId") REFERENCES "ServicePackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
