ALTER TABLE "Salon" ADD COLUMN "legalName" TEXT;

ALTER TABLE "Branch"
  ADD COLUMN "branchCode" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "openingTime" TEXT,
  ADD COLUMN "closingTime" TEXT;

CREATE UNIQUE INDEX "Branch_salonId_branchCode_key" ON "Branch"("salonId", "branchCode");
