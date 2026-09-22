// Self-check for the totals previewed on the Retail Sale page.
// Run: node frontend/src/pages/salon/__checks__/retailSaleTotals.check.mjs
// Mirrors the summary math in RetailProducts.jsx, which in turn mirrors
// createRetailSale in backend/src/features/retail-sales/retail-sale.controller.ts.
import assert from "node:assert/strict";

const round2 = (value) => Math.round(value * 100) / 100;

export const retailTotals = (items, discountPercentInput, taxPercent) => {
  const subtotal = items.reduce((sum, item) => sum + (item.productId ? item.quantity * item.price : 0), 0);
  const discountPercent = Math.min(Math.max(Number(discountPercentInput) || 0, 0), 100);
  const manualDiscount = round2(subtotal * discountPercent / 100);
  const taxable = subtotal - manualDiscount;
  return { subtotal, manualDiscount, total: taxable + taxable * taxPercent / 100 };
};

// 10% off ₹450, then 18% GST on ₹405.
assert.deepEqual(retailTotals([{ productId: "a", quantity: 3, price: 150 }], "10", 18), {
  subtotal: 450,
  manualDiscount: 45,
  total: 477.9,
});

// A price typed on a blank line is not submitted, so it can't inflate the discount.
assert.equal(retailTotals([{ productId: "", quantity: 1, price: 999 }, { productId: "a", quantity: 1, price: 100 }], 50, 0).manualDiscount, 50);

// Out-of-range input clamps, so the API never sees a discount above the subtotal.
assert.equal(retailTotals([{ productId: "a", quantity: 1, price: 80 }], 250, 0).manualDiscount, 80);
assert.equal(retailTotals([{ productId: "a", quantity: 1, price: 80 }], -5, 0).manualDiscount, 0);

console.log("retailSaleTotals: ok");
