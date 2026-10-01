import {
  membershipPaymentBreakdown,
  membershipSaleMethod,
} from "../features/customer-memberships/customer-membership.service.js";

describe("membership report helpers", () => {
  it("prefers the method recorded on a direct sale", () => {
    expect(
      membershipSaleMethod({
        paymentMethod: "CARD",
        invoice: { payments: [{ method: "CASH" }] },
      })
    ).toBe("CARD");
  });

  it("falls back to the bill's distinct payment methods", () => {
    expect(
      membershipSaleMethod({
        paymentMethod: null,
        invoice: {
          payments: [{ method: "CASH" }, { method: "UPI" }, { method: "CASH" }],
        },
      })
    ).toBe("CASH + UPI");
    expect(membershipSaleMethod({ paymentMethod: null, invoice: null })).toBe(
      "UNPAID"
    );
  });

  it("totals sales per method, largest first", () => {
    expect(
      membershipPaymentBreakdown([
        { method: "CASH", amount: 1000 },
        { method: "UPI", amount: 5000 },
        { method: "CASH", amount: 2000 },
      ])
    ).toEqual([
      { method: "UPI", count: 1, amount: 5000 },
      { method: "CASH", count: 2, amount: 3000 },
    ]);
  });
});
