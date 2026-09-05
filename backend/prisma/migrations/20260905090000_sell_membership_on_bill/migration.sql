-- A membership is now sold as a taxed line on the appointment or job cart
-- bill, alongside services, products and packages. The CustomerMembership
-- row is still created at confirm time and keeps its own invoiceId link.
ALTER TYPE "InvoiceItemType" ADD VALUE IF NOT EXISTS 'MEMBERSHIP';

ALTER TABLE "InvoiceItem" ADD COLUMN IF NOT EXISTS "membershipId" TEXT;

CREATE INDEX IF NOT EXISTS "InvoiceItem_membershipId_idx"
  ON "InvoiceItem"("membershipId");

ALTER TABLE "InvoiceItem"
  ADD CONSTRAINT "InvoiceItem_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "Membership"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
