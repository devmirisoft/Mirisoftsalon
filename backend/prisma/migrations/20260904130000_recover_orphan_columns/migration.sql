-- Recovers columns that existed in the development database but had no
-- migration in the repo, so a fresh deploy builds the same schema.
-- Guarded because the development database already has them.

ALTER TABLE "ServicePackage"
  ADD COLUMN IF NOT EXISTS "maxRedemptions" INTEGER;

ALTER TABLE "CustomerPackage"
  ADD COLUMN IF NOT EXISTS "maxRedemptionsSnapshot" INTEGER,
  ADD COLUMN IF NOT EXISTS "usedRedemptions" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "reservedRedemptions" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CustomerMembership"
  ADD COLUMN IF NOT EXISTS "priceSnapshot" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "walletCreditSnapshot" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "paymentReference" TEXT;
