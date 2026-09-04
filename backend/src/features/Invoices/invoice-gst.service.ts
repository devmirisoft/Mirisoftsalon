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
  /** False for lines a percentage discount must never touch, e.g. products. */
  discountable?: boolean;
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
  roundOffAmount: Prisma.Decimal;
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
  // A discount is only ever spread across the lines that allow one. Products
  // are billed at full price even for a member, so they are excluded from the
  // base and never receive a share below.
  const isDiscountable = (index: number) =>
    invoice.items[index]?.discountable !== false;
  const discountableSubtotal = money(
    grossLines.reduce(
      (sum, value, index) => (isDiscountable(index) ? sum.plus(value) : sum),
      ZERO
    )
  );
  const totalDiscount = Prisma.Decimal.min(
    money(invoice.discountAmount.plus(invoice.couponDiscountAmount)),
    discountableSubtotal
  );
  const lastDiscountableIndex = invoice.items.reduce(
    (last, _item, index) => (isDiscountable(index) ? index : last),
    -1
  );
  const gstEnabled =
    settings.gstEnabled && invoice.invoiceType === "GST_INVOICE";

  let allocatedDiscount = ZERO;
  const lines = invoice.items.map((item, index) => {
    const gross = grossLines[index] ?? ZERO;
    const discountShare = !isDiscountable(index)
      ? ZERO
      : index === lastDiscountableIndex
        ? money(totalDiscount.minus(allocatedDiscount))
        : discountableSubtotal.isZero()
          ? ZERO
          : money(gross.mul(totalDiscount).div(discountableSubtotal));
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
  const exactTotal = money(
    taxableAmount.plus(totalGstAmount).plus(invoice.processingFeeAmount)
  );
  // Bills are collected in whole rupees: 89.98 -> 90, 89.02 -> 89. The delta is
  // kept so subtotal + tax + roundOff == totalAmount stays provable, and so a
  // full payment can equal totalAmount exactly.
  const totalAmount = exactTotal.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  const roundOffAmount = money(totalAmount.minus(exactTotal));

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
    roundOffAmount,
    totalAmount,
    gstNumberSnapshot: gstEnabled ? settings.gstNumber : null,
    gstLegalNameSnapshot: gstEnabled ? settings.gstLegalName : null,
    gstStateCodeSnapshot: gstEnabled ? settings.gstStateCode : null,
    gstEnabledSnapshot: gstEnabled,
    lines,
  };
};
