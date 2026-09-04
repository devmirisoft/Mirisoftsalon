import { assignmentSchema } from "../features/customer-memberships/customer-membership.controller.js";

const membershipId = "11111111-1111-4111-8111-111111111111";

describe("membership sale payment method", () => {
  it("accepts the tenders a membership can be sold for", () => {
    for (const paymentMethod of [
      "CASH",
      "UPI",
      "PAYTM",
      "PHONEPE",
      "GPAY",
      "CARD",
      "BANK_TRANSFER",
      "CHEQUE",
      "OTHER",
    ]) {
      const parsed = assignmentSchema.parse({
        membershipId,
        paymentMethod,
        amountPaid: 2500,
      });
      expect(parsed.paymentMethod).toBe(paymentMethod);
      expect(parsed.amountPaid).toBe(2500);
    }
  });

  it("rejects paying for a membership by redeeming a membership wallet", () => {
    expect(() =>
      assignmentSchema.parse({
        membershipId,
        paymentMethod: "MEMBERSHIP_WALLET",
      })
    ).toThrow();
  });

  it("leaves payment details optional", () => {
    const parsed = assignmentSchema.parse({ membershipId });
    expect(parsed.paymentMethod).toBeUndefined();
    expect(parsed.amountPaid).toBeUndefined();
  });

  it("treats a blank amount as not recorded rather than zero", () => {
    expect(assignmentSchema.parse({ membershipId, amountPaid: "" }).amountPaid)
      .toBeUndefined();
    expect(assignmentSchema.parse({ membershipId, amountPaid: "3000" }).amountPaid)
      .toBe(3000);
  });

  it("rejects a negative amount collected", () => {
    expect(() =>
      assignmentSchema.parse({
        membershipId,
        paymentMethod: "CASH",
        amountPaid: -1,
      })
    ).toThrow();
  });
});
