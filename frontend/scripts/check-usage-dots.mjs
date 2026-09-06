// Self-check for the package usage-dot maths on the customer profile page.
// Run: node frontend/scripts/check-usage-dots.mjs
import assert from "node:assert/strict";

// Kept in sync with usageDotCounts in src/pages/salon/JobCartCustomerHistory.jsx.
const usageDotCounts = (included, used = 0, reserved = 0) => {
  const total = Math.max(Number(included) || 0, 0);
  const spent = Math.min(
    Math.max((Number(used) || 0) + (Number(reserved) || 0), 0),
    total
  );
  return { total, spent };
};

// The case from the brief: 10 included, 7 used -> 7 filled, 3 hollow.
assert.deepEqual(usageDotCounts(10, 7), { total: 10, spent: 7 });

// Reserved uses count as spent so the page never promises a use the till
// will refuse.
assert.deepEqual(usageDotCounts(10, 7, 2), { total: 10, spent: 9 });

// Over-consumption clamps instead of rendering negative/extra dots.
assert.deepEqual(usageDotCounts(5, 7, 3), { total: 5, spent: 5 });
assert.deepEqual(usageDotCounts(5, -2), { total: 5, spent: 0 });

// Missing or junk values degrade to an empty meter, not NaN dots.
assert.deepEqual(usageDotCounts(undefined), { total: 0, spent: 0 });
assert.deepEqual(usageDotCounts(null, null, null), { total: 0, spent: 0 });
assert.deepEqual(usageDotCounts(3, undefined, undefined), {
  total: 3,
  spent: 0,
});

console.log("usage-dot checks passed");
