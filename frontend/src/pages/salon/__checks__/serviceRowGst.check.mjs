// Self-check for the editable price/total pair on a job cart service row.
// Run: node frontend/src/pages/salon/__checks__/serviceRowGst.check.mjs
// Mirrors priceToTotal + totalToPrice in JobCartCreate.jsx.
import assert from "node:assert/strict";

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;
export const priceToTotal = (price, gst) =>
  String(round2(Number(price || 0) * (1 + gst / 100)));
export const totalToPrice = (total, gst) =>
  String(round2(Number(total || 0) / (1 + gst / 100)));

// Editing price fills the GST-inclusive total.
assert.equal(priceToTotal(1000, 18), "1180");
assert.equal(priceToTotal(999.5, 5), "1049.48");

// Editing total back-solves the pre-GST price.
assert.equal(totalToPrice(1180, 18), "1000");
assert.equal(totalToPrice(1000, 18), "847.46");

// GST off: the two figures are the same number.
assert.equal(priceToTotal(750, 0), "750");
assert.equal(totalToPrice(750, 0), "750");

// Blank input stays at zero rather than NaN.
assert.equal(priceToTotal("", 18), "0");
assert.equal(totalToPrice("", 18), "0");

// Round trip lands within a rupee of where it started.
for (const total of [1180, 999, 250.75]) {
  const back = Number(priceToTotal(totalToPrice(total, 18), 18));
  assert.ok(Math.abs(back - total) < 0.01, `round trip drifted for ${total}`);
}

console.log("serviceRowGst check passed");
