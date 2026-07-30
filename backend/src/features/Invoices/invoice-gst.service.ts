import { Prisma } from "../../generated/prisma/client.js";

const ZERO = new Prisma.Decimal(0);
const ONE_HUNDRED = new Prisma.Decimal(100);
type DecimalInput = string | number | Prisma.Decimal;

export type GstSalonSettings = {
  gstEnabled: boolean;
  gstNumber: string | null;
  gstLegalName: string | null;
  gstStateCode: string | null;
  serviceGstRate: Prisma.Decimal;
  productGstRate: Prisma.Decimal;
};

export type GstInvoiceLineInput = {
  id?: string;
  itemType?: string;
  quantity: number | Prisma.Decimal;
  unitPrice: Prisma.Decimal;
};

export type GstInvoiceInput = {
  invoiceType: string;
  discountAmount: Prisma.Decimal;
  couponDiscountAmount: Prisma.Decimal;
  processingFeeAmount: Prisma.Decimal;
  items: GstInvoiceLineInput[];
};

export type GstLineSnapshot = {
  taxableAmount: Prisma.Decimal;
  gstRateSnapshot: Prisma.Decimal;
  gstAmount: Prisma.Decimal;
  totalWithTax: Prisma.Decimal;
  taxPercent: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
};

export type GstInvoiceCalculation = {
  subtotalAmount: Prisma.Decimal;
  serviceTaxableAmount: Prisma.Decimal;
  productTaxableAmount: Prisma.Decimal;
  serviceGstAmount: Prisma.Decimal;
  productGstAmount: Prisma.Decimal;
  totalGstAmount: Prisma.Decimal;
  taxableAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  gstNumberSnapshot: string | null;
  gstLegalNameSnapshot: string | null;
  gstStateCodeSnapshot: string | null;
  gstEnabledSnapshot: boolean;
  lines: GstLineSnapshot[];
};

const money = (value: DecimalInput) =>
  new Prisma.Decimal(value).toDecimalPlaces(2);

const rate = (value: DecimalInput) =>
  new Prisma.Decimal(value).toDecimalPlaces(2);

const isProductLine = (itemType?: string) => itemType === "PRODUCT";

export const calculateInvoiceGst = (
  invoice: GstInvoiceInput,
  settings: GstSalonSettings
): GstInvoiceCalculation => {
  const grossLines = invoice.items.map((item) =>
    money(new Prisma.Decimal(item.quantity).mul(item.unitPrice))
  );
  const subtotalAmount = money(
    grossLines.reduce((sum, value) => sum.plus(value), ZERO)
  );
  const totalDiscount = Prisma.Decimal.min(
    money(invoice.discountAmount.plus(invoice.couponDiscountAmount)),
    subtotalAmount
  );
  const gstEnabled =
    settings.gstEnabled && invoice.invoiceType === "GST_INVOICE";

  let allocatedDiscount = ZERO;
  const lines = invoice.items.map((item, index) => {
    const gross = grossLines[index] ?? ZERO;
    const discountShare =
      index === invoice.items.length - 1
        ? money(totalDiscount.minus(allocatedDiscount))
        : subtotalAmount.isZero()
          ? ZERO
          : money(gross.mul(totalDiscount).div(subtotalAmount));
    allocatedDiscount = allocatedDiscount.plus(discountShare);
    const taxableAmount = Prisma.Decimal.max(
      gross.minus(discountShare),
      ZERO
    ).toDecimalPlaces(2);
    const gstRateSnapshot = gstEnabled
      ? rate(isProductLine(item.itemType) ? settings.productGstRate : settings.serviceGstRate)
      : ZERO;
    const gstAmount = taxableAmount
      .mul(gstRateSnapshot)
      .div(ONE_HUNDRED)
      .toDecimalPlaces(2);
    const totalWithTax = taxableAmount.plus(gstAmount).toDecimalPlaces(2);

    return {
      taxableAmount,
      gstRateSnapshot,
      gstAmount,
      totalWithTax,
      taxPercent: gstRateSnapshot,
      taxAmount: gstAmount,
      lineTotal: totalWithTax,
    };
  });

  const serviceTaxableAmount = money(
    lines.reduce(
      (sum, line, index) =>
        isProductLine(invoice.items[index]?.itemType)
          ? sum
          : sum.plus(line.taxableAmount),
      ZERO
    )
  );
  const productTaxableAmount = money(
    lines.reduce(
      (sum, line, index) =>
        isProductLine(invoice.items[index]?.itemType)
          ? sum.plus(line.taxableAmount)
          : sum,
      ZERO
    )
  );
  const serviceGstAmount = money(
    lines.reduce(
      (sum, line, index) =>
        isProductLine(invoice.items[index]?.itemType)
          ? sum
          : sum.plus(line.gstAmount),
      ZERO
    )
  );
  const productGstAmount = money(
    lines.reduce(
      (sum, line, index) =>
        isProductLine(invoice.items[index]?.itemType)
          ? sum.plus(line.gstAmount)
          : sum,
      ZERO
    )
  );
  const totalGstAmount = money(serviceGstAmount.plus(productGstAmount));
  const taxableAmount = money(serviceTaxableAmount.plus(productTaxableAmount));
  const totalAmount = money(
    taxableAmount.plus(totalGstAmount).plus(invoice.processingFeeAmount)
  );

  if (taxableAmount.isNegative() || totalGstAmount.isNegative() || totalAmount.isNegative()) {
    throw Object.assign(new Error("Invoice totals cannot be negative"), {
      status: 400,
    });
  }

  return {
    subtotalAmount,
    serviceTaxableAmount,
    productTaxableAmount,
    serviceGstAmount,
    productGstAmount,
    totalGstAmount,
    taxableAmount,
    totalAmount,
    gstNumberSnapshot: gstEnabled ? settings.gstNumber : null,
    gstLegalNameSnapshot: gstEnabled ? settings.gstLegalName : null,
    gstStateCodeSnapshot: gstEnabled ? settings.gstStateCode : null,
    gstEnabledSnapshot: gstEnabled,
    lines,
  };
};
