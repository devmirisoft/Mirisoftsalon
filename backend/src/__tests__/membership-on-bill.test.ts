import { Prisma } from "../generated/prisma/client.js";
import { calculateInvoiceGst } from "../features/Invoices/invoice-gst.service.js";
import { addJobCartItemSchema } from "../features/job-carts/job-cart.validation.js";

const decimal = (value: string | number) => new Prisma.Decimal(value);
const membershipId = "22222222-2222-4222-8222-222222222222";

const settings = {
  gstEnabled: true,
  gstNumber: "27ABCDE1234F1Z5",
  gstLegalName: "Test Salon Pvt Ltd",
  gstStateCode: "27",
  serviceGstRate: decimal("5.00"),
  productGstRate: decimal("18.00"),
};

describe("membership sold on a bill", () => {
  it("taxes a membership line at the service rate", () => {
    const result = calculateInvoiceGst(
      {
        invoiceType: "GST_INVOICE",
        discountAmount: decimal("0"),
        couponDiscountAmount: decimal("0"),
        processingFeeAmount: decimal("0"),
        items: [
          {
            itemType: "MEMBERSHIP",
            quantity: 1,
            unitPrice: decimal("5000.00"),
            discountable: false,
          },
        ],
      },
      settings
    );

    expect(result.serviceTaxableAmount.toFixed(2)).toBe("5000.00");
    expect(result.productTaxableAmount.toFixed(2)).toBe("0.00");
    expect(result.totalGstAmount.toFixed(2)).toBe("250.00");
    expect(result.totalAmount.toFixed(2)).toBe("5250.00");
    expect(result.lines[0]?.lineTotal.toFixed(2)).toBe("5250.00");
  });

  it("never spreads a discount onto the membership line", () => {
    // 200 off a bill of one 1000 service plus a 5000 plan: all 200 lands on
    // the service, because buying a plan is not cheaper for a member.
    const result = calculateInvoiceGst(
      {
        invoiceType: "GST_INVOICE",
        discountAmount: decimal("200.00"),
        couponDiscountAmount: decimal("0"),
        processingFeeAmount: decimal("0"),
        items: [
          { itemType: "SERVICE", quantity: 1, unitPrice: decimal("1000.00") },
          {
            itemType: "MEMBERSHIP",
            quantity: 1,
            unitPrice: decimal("5000.00"),
            discountable: false,
          },
        ],
      },
      settings
    );

    expect(result.lines[0]?.taxableAmount.toFixed(2)).toBe("800.00");
    expect(result.lines[1]?.taxableAmount.toFixed(2)).toBe("5000.00");
    expect(result.totalAmount.toFixed(2)).toBe("6090.00");
  });

  it("requires a membershipId on a membership job cart item", () => {
    expect(() =>
      addJobCartItemSchema.parse({ itemType: "MEMBERSHIP" })
    ).toThrow();
    expect(
      addJobCartItemSchema.parse({ itemType: "MEMBERSHIP", membershipId })
        .membershipId
    ).toBe(membershipId);
  });
});
