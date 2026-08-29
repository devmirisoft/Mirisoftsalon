-- AlterTable
ALTER TABLE "ServicePackage" ADD COLUMN     "maxRedemptions" INTEGER;

-- AlterTable
ALTER TABLE "CustomerPackage" ADD COLUMN     "maxRedemptionsSnapshot" INTEGER,
ADD COLUMN     "usedRedemptions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reservedRedemptions" INTEGER NOT NULL DEFAULT 0;
