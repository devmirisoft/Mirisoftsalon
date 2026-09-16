// Self-check for the discount split previewed on the "Make bill" page.
// Run: node frontend/src/pages/salon/__checks__/appointmentBillDiscount.check.mjs
// Mirrors the preview useMemo in AppointmentBill.jsx, which in turn mirrors
// createInvoiceFromAppointment in backend/src/features/Invoices/invoice.controller.ts.
import assert from "node:assert/strict";

export const splitDiscount = (serviceSubtotal, typedAmount, membershipPercent) => {
  const manualDiscount = Math.min(Number(typedAmount || 0), serviceSubtotal);
  const membershipDiscount = Math.min(
    (serviceSubtotal * Number(membershipPercent || 0)) / 100,
    serviceSubtotal - manualDiscount
  );
  return {
    manualDiscount,
    membershipDiscount,
    discount: Math.min(manualDiscount + membershipDiscount, serviceSubtotal),
  };
};

// No membership: the typed amount is the whole discount.
assert.deepEqual(splitDiscount(1000, 100, 0), {
  manualDiscount: 100,
  membershipDiscount: 0,
  discount: 100,
});

// A membership stacks on top of the typed amount, and both are shown apart.
assert.deepEqual(splitDiscount(1000, 100, 10), {
  manualDiscount: 100,
  membershipDiscount: 100,
  discount: 200,
});

// The membership share is capped by what the typed discount left behind, so
// the two together never exceed the services they came off.
assert.deepEqual(splitDiscount(1000, 950, 10), {
  manualDiscount: 950,
  membershipDiscount: 50,
  discount: 1000,
});

// A typed amount above the services is clamped, and nothing is left to give.
assert.deepEqual(splitDiscount(1000, 5000, 10), {
  manualDiscount: 1000,
  membershipDiscount: 0,
  discount: 1000,
});

// A 100% membership zeroes the services without going negative.
assert.deepEqual(splitDiscount(1000, 0, 100), {
  manualDiscount: 0,
  membershipDiscount: 1000,
  discount: 1000,
});

// Nothing billed yet: no NaN leaks into the summary rows.
assert.deepEqual(splitDiscount(0, "", undefined), {
  manualDiscount: 0,
  membershipDiscount: 0,
  discount: 0,
});

console.log("appointmentBillDiscount check passed");
