// The usage step decides which container each millilitre comes from, and the
// server books exactly those parts, so the split gets a real check.
// Run: node frontend/src/utils/__checks__/usageAllocation.check.mjs
import assert from "node:assert/strict";
import { allocateUsage, isValidQuantity } from "../usageAllocation.js";

const products = {
  shampoo: {
    containerTracked: true,
    openContainers: [
      { id: "SH-001", remainingQuantity: "20" },
      { id: "SH-002", remainingQuantity: "10" },
      { id: "SH-003", remainingQuantity: "1000" },
    ],
  },
  gloves: { containerTracked: false, stock: { SERVICE: "3" } },
};

// Oldest first, spilling into the next container.
assert.deepEqual(
  allocateUsage([{ key: "a", productId: "shampoo", actual: 50 }], products).a,
  {
    parts: [
      { containerId: "SH-001", quantity: 20 },
      { containerId: "SH-002", quantity: 10 },
      { containerId: "SH-003", quantity: 20 },
    ],
    shortfall: 0,
  }
);

// The chosen container goes first; a second line sees what the first took.
const two = allocateUsage(
  [
    { key: "wash", productId: "shampoo", actual: 990, containerId: "SH-003" },
    { key: "spa", productId: "shampoo", actual: 80, containerId: "SH-003" },
  ],
  products
);
assert.deepEqual(two.wash.parts, [{ containerId: "SH-003", quantity: 990 }]);
assert.deepEqual(two.spa.parts, [
  { containerId: "SH-003", quantity: 10 },
  { containerId: "SH-001", quantity: 20 },
  { containerId: "SH-002", quantity: 10 },
]);
assert.equal(two.spa.shortfall, 40);

// Nothing open: the whole amount is short, which is what offers a new pack.
assert.deepEqual(
  allocateUsage([{ key: "x", productId: "shampoo", actual: 50 }], {
    shampoo: { containerTracked: true, openContainers: [] },
  }).x,
  { parts: [], shortfall: 50 }
);

// Sealed service stock is shared across lines.
const gloves = allocateUsage(
  [
    { key: "g1", productId: "gloves", actual: 2 },
    { key: "g2", productId: "gloves", actual: 2 },
  ],
  products
);
assert.equal(gloves.g1.shortfall, 0);
assert.equal(gloves.g2.shortfall, 1);

// Hundredths, not floats: 0.1 + 0.2 from a 0.3 container leaves nothing short.
const exact = allocateUsage(
  [
    { key: "p", productId: "serum", actual: 0.1 },
    { key: "q", productId: "serum", actual: 0.2 },
  ],
  { serum: { containerTracked: true, openContainers: [{ id: "S1", remainingQuantity: "0.3" }] } }
);
assert.equal(exact.q.shortfall, 0);
assert.deepEqual(exact.q.parts, [{ containerId: "S1", quantity: 0.2 }]);

assert.equal(isValidQuantity("50"), true);
assert.equal(isValidQuantity("0"), true);
assert.equal(isValidQuantity("12.25"), true);
assert.equal(isValidQuantity("0.125"), false);
assert.equal(isValidQuantity("-1"), false);
assert.equal(isValidQuantity(""), false);
assert.equal(isValidQuantity("abc"), false);

console.log("usageAllocation: ok");
