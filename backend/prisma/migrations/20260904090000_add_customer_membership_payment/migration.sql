-- Records how a membership was sold: the tender used, what was collected, and
-- which staff member made the sale. All nullable so existing rows (and
-- job-cart/invoice-driven sales that already carry their own Payment rows)
-- stay valid.
ALTER TABLE "CustomerMembership"
  ADD COLUMN "paymentMethod" "PaymentMethod",
  ADD COLUMN "amountPaid" DECIMAL(10,2),
  ADD COLUMN "soldByStaffId" TEXT;

CREATE INDEX "CustomerMembership_soldByStaffId_idx"
  ON "CustomerMembership"("soldByStaffId");

ALTER TABLE "CustomerMembership"
  ADD CONSTRAINT "CustomerMembership_soldByStaffId_fkey"
  FOREIGN KEY ("soldByStaffId") REFERENCES "Staff"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
