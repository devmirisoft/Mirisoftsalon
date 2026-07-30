import { Prisma } from "../generated/prisma/client.js";
import { calculateInvoiceGst } from "../features/Invoices/invoice-gst.service.js";

const decimal = (value: string | number) => new Prisma.Decimal(value);

const settings = {
  gstEnabled: true,
  gstNumber: "27ABCDE1234F1Z5",
  gstLegalName: "Test Salon Pvt Ltd",
  gstStateCode: "27",
  serviceGstRate: decimal("5.00"),
  productGstRate: decimal("18.00"),
};

describe("invoice GST calculator", () => {
  it("uses 5% default service GST and 18% default product GST separately", () => {
    const result = calculateInvoiceGst(
      {
        invoiceType: "GST_INVOICE",
        discountAmount: decimal("0"),
        couponDiscountAmount: decimal("0"),
        processingFeeAmount: decimal("0"),
        items: [
          { itemType: "SERVICE", quantity: 1, unitPrice: decimal("100.00") },
          { itemType: "PRODUCT", quantity: 1, unitPrice: decimal("100.00") },
        ],
      },
      settings
    );

    expect(result.serviceTaxableAmount.toFixed(2)).toBe("100.00");
    expect(result.productTaxableAmount.toFixed(2)).toBe("100.00");
    expect(result.serviceGstAmount.toFixed(2)).toBe("5.00");
    expect(result.productGstAmount.toFixed(2)).toBe("18.00");
    expect(result.totalGstAmount.toFixed(2)).toBe("23.00");
    expect(result.totalAmount.toFixed(2)).toBe("223.00");
  });

  it("uses custom salon rates and rounds each line GST before summing", () => {
    const result = calculateInvoiceGst(
      {
        invoiceType: "GST_INVOICE",
        discountAmount: decimal("0"),
        couponDiscountAmount: decimal("0"),
        processingFeeAmount: decimal("0"),
        items: [
          { itemType: "SERVICE", quantity: 1, unitPrice: decimal("0.33") },
          { itemType: "SERVICE", quantity: 1, unitPrice: decimal("0.33") },
        ],
      },
      {
        ...settings,
        serviceGstRate: decimal("7.50"),
        productGstRate: decimal("12.00"),
      }
    );

    expect(result.lines.map((line) => line.gstAmount.toFixed(2))).toEqual([
      "0.02",
      "0.02",
    ]);
    expect(result.totalGstAmount.toFixed(2)).toBe("0.04");
  });

  it("allocates membership and coupon discounts before GST", () => {
    const result = calculateInvoiceGst(
      {
        invoiceType: "GST_INVOICE",
        discountAmount: decimal("10.00"),
        couponDiscountAmount: decimal("10.00"),
        processingFeeAmount: decimal("0"),
        items: [
          { itemType: "SERVICE", quantity: 1, unitPrice: decimal("100.00") },
          { itemType: "PRODUCT", quantity: 1, unitPrice: decimal("100.00") },
        ],
      },
      settings
    );

    expect(result.serviceTaxableAmount.toFixed(2)).toBe("90.00");
    expect(result.productTaxableAmount.toFixed(2)).toBe("90.00");
    expect(result.serviceGstAmount.toFixed(2)).toBe("4.50");
    expect(result.productGstAmount.toFixed(2)).toBe("16.20");
    expect(result.totalAmount.toFixed(2)).toBe("200.70");
  });

  it("sets GST to zero and clears snapshots when GST is disabled", () => {
    const result = calculateInvoiceGst(
      {
        invoiceType: "GST_INVOICE",
        discountAmount: decimal("0"),
        couponDiscountAmount: decimal("0"),
        processingFeeAmount: decimal("5.00"),
        items: [
          { itemType: "SERVICE", quantity: 1, unitPrice: decimal("100.00") },
        ],
      },
      { ...settings, gstEnabled: false }
    );

    expect(result.totalGstAmount.toFixed(2)).toBe("0.00");
    expect(result.totalAmount.toFixed(2)).toBe("105.00");
    expect(result.gstEnabledSnapshot).toBe(false);
    expect(result.gstNumberSnapshot).toBeNull();
  });

  it("caps discounts so taxable amount never becomes negative", () => {
    const result = calculateInvoiceGst(
      {
        invoiceType: "GST_INVOICE",
        discountAmount: decimal("200.00"),
        couponDiscountAmount: decimal("0"),
        processingFeeAmount: decimal("0"),
        items: [
          { itemType: "SERVICE", quantity: 1, unitPrice: decimal("100.00") },
        ],
      },
      settings
    );

    expect(result.taxableAmount.toFixed(2)).toBe("0.00");
    expect(result.totalAmount.toFixed(2)).toBe("0.00");
  });
});
