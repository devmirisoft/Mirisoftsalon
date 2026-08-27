-- Membership plans gain a validity duration and a wallet credit value.
ALTER TABLE "Membership"
ADD COLUMN "durationMonths" INTEGER,
ADD COLUMN "price" DECIMAL(10, 2) NOT NULL DEFAULT 0,
ADD COLUMN "walletCreditAmount" DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- Enrollments carry their own wallet, snapshotted duration, and forfeit record.
ALTER TABLE "CustomerMembership"
ADD COLUMN "durationMonthsSnapshot" INTEGER,
ADD COLUMN "walletCredited" DECIMAL(10, 2) NOT NULL DEFAULT 0,
ADD COLUMN "walletDebited" DECIMAL(10, 2) NOT NULL DEFAULT 0,
ADD COLUMN "walletBalance" DECIMAL(10, 2) NOT NULL DEFAULT 0,
ADD COLUMN "forfeitedAmount" DECIMAL(10, 2) NOT NULL DEFAULT 0,
ADD COLUMN "forfeitedAt" TIMESTAMP(3);

CREATE TYPE "MembershipWalletTransactionType" AS ENUM (
  'PURCHASE_CREDIT',
  'TOPUP',
  'SPEND',
  'REFUND',
  'FORFEIT',
  'ADJUSTMENT'
);

CREATE TABLE "MembershipWalletTransaction" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "branchId" TEXT,
  "customerId" TEXT NOT NULL,
  "customerMembershipId" TEXT NOT NULL,
  "type" "MembershipWalletTransactionType" NOT NULL,
  "credit" DECIMAL(10, 2) NOT NULL DEFAULT 0,
  "debit" DECIMAL(10, 2) NOT NULL DEFAULT 0,
  "balanceAfter" DECIMAL(10, 2) NOT NULL,
  "narration" TEXT,
  "invoiceId" TEXT,
  "paymentId" TEXT,
  "jobCartAppointmentId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MembershipWalletTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MembershipWalletTransaction_salonId_idx" ON "MembershipWalletTransaction"("salonId");
CREATE INDEX "MembershipWalletTransaction_branchId_idx" ON "MembershipWalletTransaction"("branchId");
CREATE INDEX "MembershipWalletTransaction_customerId_idx" ON "MembershipWalletTransaction"("customerId");
CREATE INDEX "MembershipWalletTransaction_customerMembershipId_idx" ON "MembershipWalletTransaction"("customerMembershipId");
CREATE INDEX "MembershipWalletTransaction_type_idx" ON "MembershipWalletTransaction"("type");
CREATE INDEX "MembershipWalletTransaction_invoiceId_idx" ON "MembershipWalletTransaction"("invoiceId");
CREATE INDEX "MembershipWalletTransaction_paymentId_idx" ON "MembershipWalletTransaction"("paymentId");
CREATE INDEX "MembershipWalletTransaction_jobCartAppointmentId_idx" ON "MembershipWalletTransaction"("jobCartAppointmentId");
CREATE INDEX "MembershipWalletTransaction_createdAt_idx" ON "MembershipWalletTransaction"("createdAt");

ALTER TABLE "MembershipWalletTransaction" ADD CONSTRAINT "MembershipWalletTransaction_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MembershipWalletTransaction" ADD CONSTRAINT "MembershipWalletTransaction_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MembershipWalletTransaction" ADD CONSTRAINT "MembershipWalletTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipWalletTransaction" ADD CONSTRAINT "MembershipWalletTransaction_customerMembershipId_fkey" FOREIGN KEY ("customerMembershipId") REFERENCES "CustomerMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipWalletTransaction" ADD CONSTRAINT "MembershipWalletTransaction_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MembershipWalletTransaction" ADD CONSTRAINT "MembershipWalletTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MembershipWalletTransaction" ADD CONSTRAINT "MembershipWalletTransaction_jobCartAppointmentId_fkey" FOREIGN KEY ("jobCartAppointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MembershipWalletTransaction" ADD CONSTRAINT "MembershipWalletTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
