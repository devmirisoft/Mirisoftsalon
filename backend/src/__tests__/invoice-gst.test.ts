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

  it("rounds the total to whole rupees in both directions and records the delta", () => {
    // 89.98 -> 90 (up), and the stored delta must reconcile the invoice.
    const up = calculateInvoiceGst(
      {
        invoiceType: "BILL_OF_SUPPLY",
        discountAmount: decimal("0"),
        couponDiscountAmount: decimal("0"),
        processingFeeAmount: decimal("0"),
        items: [{ itemType: "SERVICE", quantity: 1, unitPrice: decimal("89.98") }],
      },
      settings
    );
    expect(up.totalAmount.toFixed(2)).toBe("90.00");
    expect(up.roundOffAmount.toFixed(2)).toBe("0.02");
    expect(
      up.taxableAmount.plus(up.totalGstAmount).plus(up.roundOffAmount).toFixed(2)
    ).toBe(up.totalAmount.toFixed(2));

    // 89.02 -> 89 (down): nearest-rupee, so the customer is not overcharged.
    const down = calculateInvoiceGst(
      {
        invoiceType: "BILL_OF_SUPPLY",
        discountAmount: decimal("0"),
        couponDiscountAmount: decimal("0"),
        processingFeeAmount: decimal("0"),
        items: [{ itemType: "SERVICE", quantity: 1, unitPrice: decimal("89.02") }],
      },
      settings
    );
    expect(down.totalAmount.toFixed(2)).toBe("89.00");
    expect(down.roundOffAmount.toFixed(2)).toBe("-0.02");
  });

  it("never applies a discount to a product line", () => {
    // 1000 service + 500 product, 100 membership discount. The whole discount
    // belongs to the service; the product stays taxable at its full 500.
    const result = calculateInvoiceGst(
      {
        invoiceType: "GST_INVOICE",
        discountAmount: decimal("100.00"),
        couponDiscountAmount: decimal("0"),
        processingFeeAmount: decimal("0"),
        items: [
          { itemType: "SERVICE", quantity: 1, unitPrice: decimal("1000.00") },
          {
            itemType: "PRODUCT",
            quantity: 1,
            unitPrice: decimal("500.00"),
            discountable: false,
          },
        ],
      },
      settings
    );

    expect(result.serviceTaxableAmount.toFixed(2)).toBe("900.00");
    expect(result.productTaxableAmount.toFixed(2)).toBe("500.00");
    expect(result.lines[1]?.taxableAmount.toFixed(2)).toBe("500.00");
    expect(result.productGstAmount.toFixed(2)).toBe("90.00");
  });

  it("caps a discount at the discountable subtotal, not the whole bill", () => {
    // Only 200 of service is discountable, so a 900 discount cannot eat the
    // 1000 product line as well.
    const result = calculateInvoiceGst(
      {
        invoiceType: "BILL_OF_SUPPLY",
        discountAmount: decimal("900.00"),
        couponDiscountAmount: decimal("0"),
        processingFeeAmount: decimal("0"),
        items: [
          { itemType: "SERVICE", quantity: 1, unitPrice: decimal("200.00") },
          {
            itemType: "PRODUCT",
            quantity: 1,
            unitPrice: decimal("1000.00"),
            discountable: false,
          },
        ],
      },
      settings
    );

    expect(result.serviceTaxableAmount.toFixed(2)).toBe("0.00");
    expect(result.productTaxableAmount.toFixed(2)).toBe("1000.00");
    expect(result.totalAmount.toFixed(2)).toBe("1000.00");
  });

  it("never discounts a product even for a member, and taxes each at its own rate", () => {
    // 1000 service + 500 shampoo, membership 10%. The whole 100 belongs to
    // the service; the product stays taxable at its full 500.
    const result = calculateInvoiceGst(
      {
        invoiceType: "GST_INVOICE",
        discountAmount: decimal("100.00"),
        couponDiscountAmount: decimal("0"),
        processingFeeAmount: decimal("0"),
        items: [
          {
            itemType: "SERVICE",
            quantity: 1,
            unitPrice: decimal("1000.00"),
            discountable: true,
          },
          {
            itemType: "PRODUCT",
            quantity: 1,
            unitPrice: decimal("500.00"),
            discountable: false,
          },
        ],
      },
      settings
    );

    expect(result.serviceTaxableAmount.toFixed(2)).toBe("900.00");
    expect(result.productTaxableAmount.toFixed(2)).toBe("500.00");
    expect(result.serviceGstAmount.toFixed(2)).toBe("45.00");
    expect(result.productGstAmount.toFixed(2)).toBe("90.00");
    expect(result.totalAmount.toFixed(2)).toBe("1535.00");
  });

  it("rounds a multi-quantity product line and reconciles the round off", () => {
    // 3 x 249.99 = 749.97, +18% = 884.96 -> 885.
    const result = calculateInvoiceGst(
      {
        invoiceType: "GST_INVOICE",
        discountAmount: decimal("0"),
        couponDiscountAmount: decimal("0"),
        processingFeeAmount: decimal("0"),
        items: [
          {
            itemType: "PRODUCT",
            quantity: 3,
            unitPrice: decimal("249.99"),
            discountable: false,
          },
        ],
      },
      settings
    );

    expect(result.productTaxableAmount.toFixed(2)).toBe("749.97");
    expect(result.totalAmount.toFixed(2)).toBe("885.00");
    expect(
      result.taxableAmount
        .plus(result.totalGstAmount)
        .plus(result.roundOffAmount)
        .toFixed(2)
    ).toBe(result.totalAmount.toFixed(2));
  });
});
