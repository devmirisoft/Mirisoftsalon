-- On-spot billing from the job card detail page.

-- Whether a membership discount also applies to packages sold on a bill.
-- Off by default: packages already carry their own discounted price, so
-- stacking a membership percentage on top is opt-in per salon.
ALTER TABLE "Salon"
  ADD COLUMN IF NOT EXISTS "membershipDiscountOnPackages" BOOLEAN NOT NULL DEFAULT false;

-- The membership share of discountAmount, tracked separately so reporting can
-- separate a membership give-away from a manually entered discount.
ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "membershipDiscountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Whole-rupee rounding. roundOffAmount stores the delta applied to reach
-- totalAmount so the invoice arithmetic stays auditable and paidAmount can
-- still equal totalAmount exactly.
ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "roundOffAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Client-supplied key for confirms queued while offline. The unique index is
-- what makes a replayed push return the existing invoice instead of billing
-- the customer a second time.
ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_idempotencyKey_key"
  ON "Invoice"("idempotencyKey");
