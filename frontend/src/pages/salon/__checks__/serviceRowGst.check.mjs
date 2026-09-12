// Self-check for the editable qty/price/total trio on a job cart service row.
// Run: node frontend/src/pages/salon/__checks__/serviceRowGst.check.mjs
// Mirrors priceToTotal + totalToPrice in JobCartCreate.jsx.
import assert from "node:assert/strict";

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;
const qtyOf = (qty) => Math.max(1, Math.floor(Number(qty) || 1));
export const priceToTotal = (price, qty, gst) =>
  String(round2(Number(price || 0) * qtyOf(qty) * (1 + gst / 100)));
export const totalToPrice = (total, qty, gst) =>
  String(round2(Number(total || 0) / qtyOf(qty) / (1 + gst / 100)));

// Editing price fills the GST-inclusive line total.
assert.equal(priceToTotal(1000, 1, 18), "1180");
assert.equal(priceToTotal(999.5, 1, 5), "1049.48");

// Quantity multiplies the line, not the unit price.
assert.equal(priceToTotal(1000, 3, 18), "3540");
assert.equal(totalToPrice(3540, 3, 18), "1000");

// Editing total back-solves the pre-GST unit price.
assert.equal(totalToPrice(1180, 1, 18), "1000");
assert.equal(totalToPrice(1000, 1, 18), "847.46");

// GST off: the two figures differ only by quantity.
assert.equal(priceToTotal(750, 1, 0), "750");
assert.equal(priceToTotal(750, 2, 0), "1500");
assert.equal(totalToPrice(1500, 2, 0), "750");

// Blank and junk input stay at zero, and never divide by zero.
assert.equal(priceToTotal("", 1, 18), "0");
assert.equal(totalToPrice("", 1, 18), "0");
assert.equal(totalToPrice(1180, "", 18), "1000");
assert.equal(totalToPrice(1180, 0, 18), "1000");
assert.equal(priceToTotal(100, -5, 18), "118");

// Round trip lands within a rupee of where it started.
for (const total of [1180, 999, 250.75]) {
  for (const qty of [1, 2, 5]) {
    const back = Number(priceToTotal(totalToPrice(total, qty, 18), qty, 18));
    assert.ok(
      Math.abs(back - total) < 0.05,
      `round trip drifted for ${total} x${qty}`
    );
  }
}

console.log("serviceRowGst check passed");
