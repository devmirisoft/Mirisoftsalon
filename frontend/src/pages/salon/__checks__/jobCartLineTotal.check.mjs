// Self-check for editing a job cart line's total back into its unit price.
// Run: node frontend/src/pages/salon/__checks__/jobCartLineTotal.check.mjs
// Mirrors priceFromTotal in JobCartDetails.jsx.
import assert from "node:assert/strict";

export const priceFromTotal = (item, total) => {
  const currentTotal = Number(item.lineTotal ?? 0);
  const price = Number(item.price ?? 0);
  const next =
    currentTotal > 0 && price > 0
      ? (price * total) / currentTotal
      : total /
        Math.max(1, Number(item.quantity ?? 1)) /
        (1 + Number(item.gstPercent || 0) / 100);
  return Math.round(next * 100) / 100;
};

// Plain GST line: 1000 + 18% = 1180. Asking for 2360 doubles the unit price.
const plain = { price: 1000, quantity: 1, gstPercent: 18, lineTotal: 1180 };
assert.equal(priceFromTotal(plain, 1180), 1000);
assert.equal(priceFromTotal(plain, 2360), 2000);
assert.equal(priceFromTotal(plain, 590), 500);

// Quantity is already baked into the line total, so the ratio still holds and
// the unit price is not multiplied a second time.
const three = { price: 1000, quantity: 3, gstPercent: 18, lineTotal: 3540 };
assert.equal(priceFromTotal(three, 3540), 1000);
assert.equal(priceFromTotal(three, 7080), 2000);

// A discounted member's line: 1000 x 2, 10% off, 18% tax => 2124. The ratio
// back-solves the list price without the browser knowing about the discount,
// which a naive total/qty/(1+rate) would get wrong (it would say 900).
const member = { price: 1000, quantity: 2, gstPercent: 18, lineTotal: 2124 };
assert.equal(priceFromTotal(member, 2124), 1000);
assert.equal(priceFromTotal(member, 1062), 500);

// No tax at all: the total is the line, and the ratio is 1:1.
const noTax = { price: 750, quantity: 2, gstPercent: 0, lineTotal: 1500 };
assert.equal(priceFromTotal(noTax, 1500), 750);
assert.equal(priceFromTotal(noTax, 3000), 1500);

// A line with no ratio to read falls back to the row's own rate.
const free = { price: 0, quantity: 2, gstPercent: 18, lineTotal: 0 };
assert.equal(priceFromTotal(free, 2360), 1000);
const missing = { price: 0, quantity: 0, gstPercent: 0, lineTotal: 0 };
assert.equal(priceFromTotal(missing, 500), 500);

// Zero clears the line rather than blowing up.
assert.equal(priceFromTotal(plain, 0), 0);

console.log("jobCartLineTotal check passed");
