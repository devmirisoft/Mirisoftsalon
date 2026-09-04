// The booking cart quotes money to the customer, so the tax and duration
// rollup get a real check rather than a source-text one.
import assert from "node:assert/strict";
import { appointmentTotals, serviceMinutes } from "../appointmentTotals.js";

assert.equal(serviceMinutes({ durationValue: 2, durationUnit: "HOURS" }), 120);
assert.equal(serviceMinutes({ durationValue: 45, durationUnit: "MINUTES" }), 45);
assert.equal(serviceMinutes({}), 0);
assert.equal(serviceMinutes(null), 0);

const cart = [
  { price: 1000, minutes: 30 },
  { price: 500, minutes: 45 },
];

const taxed = appointmentTotals(cart, 18);
assert.equal(taxed.subtotal, 1500);
assert.equal(taxed.minutes, 75);
assert.equal(taxed.tax, 270);
assert.equal(taxed.total, 1770);

// GST switched off at the salon must not quietly add tax.
assert.deepEqual(appointmentTotals(cart, 0), {
  subtotal: 1500,
  minutes: 75,
  tax: 0,
  total: 1500,
});

// Per-row tax must add up to the summary tax, or the table and the total
// beside it disagree.
const rowTaxSum = cart.reduce((sum, item) => sum + (item.price * 18) / 100, 0);
assert.equal(rowTaxSum, taxed.tax);

assert.deepEqual(appointmentTotals(), {
  subtotal: 0,
  minutes: 0,
  tax: 0,
  total: 0,
});

console.log("appointment cart totals ok");
