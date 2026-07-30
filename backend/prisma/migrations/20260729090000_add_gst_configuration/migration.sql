-- Add configurable salon GST settings.
ALTER TYPE "AuditModule" ADD VALUE IF NOT EXISTS 'GST';

ALTER TABLE "Salon"
  ADD COLUMN "gstEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "gstNumber" TEXT,
  ADD COLUMN "gstLegalName" TEXT,
  ADD COLUMN "gstStateCode" TEXT,
  ADD COLUMN "serviceGstRate" DECIMAL(5,2) NOT NULL DEFAULT 5.00,
  ADD COLUMN "productGstRate" DECIMAL(5,2) NOT NULL DEFAULT 18.00,
  ADD COLUMN "gstVerifiedAt" TIMESTAMP(3);

-- Add immutable invoice-level GST snapshots.
ALTER TABLE "Invoice"
  ADD COLUMN "serviceTaxableAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "productTaxableAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "serviceGstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "productGstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "totalGstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "gstNumberSnapshot" TEXT,
  ADD COLUMN "gstLegalNameSnapshot" TEXT,
  ADD COLUMN "gstStateCodeSnapshot" TEXT,
  ADD COLUMN "gstEnabledSnapshot" BOOLEAN NOT NULL DEFAULT false;

-- Add line-level taxable and GST snapshots.
ALTER TABLE "InvoiceItem"
  ADD COLUMN "productId" TEXT,
  ADD COLUMN "taxableAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "gstRateSnapshot" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "gstAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "totalWithTax" DECIMAL(10,2) NOT NULL DEFAULT 0;

UPDATE "InvoiceItem"
SET
  "taxableAmount" = GREATEST(("quantity" * "unitPrice") - "discountAmount", 0),
  "gstRateSnapshot" = "taxPercent",
  "gstAmount" = "taxAmount",
  "totalWithTax" = "lineTotal";

UPDATE "Invoice"
SET
  "serviceTaxableAmount" = GREATEST("subtotalAmount" - "discountAmount" - "couponDiscountAmount", 0),
  "serviceGstAmount" = "taxAmount",
  "totalGstAmount" = "taxAmount";

ALTER TABLE "InvoiceItem"
  ADD CONSTRAINT "InvoiceItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "InvoiceItem_productId_idx" ON "InvoiceItem"("productId");
