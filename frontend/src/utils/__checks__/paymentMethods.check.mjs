// The invoice and the dashboard both print money per tender type, so the
// grouping gets a real check rather than a source-text one.
import assert from "node:assert/strict";
import {
  PAYMENT_METHODS,
  groupPaymentsByMethod,
  methodLabel,
} from "../paymentMethods.js";

assert.equal(methodLabel("GPAY"), "GPay");
assert.equal(methodLabel("BANK_TRANSFER"), "Bank transfer");
// Anything the enum grows before this list catches up still reads sanely.
assert.equal(methodLabel("CRYPTO_WALLET"), "Crypto Wallet");

// Two tenders of the same type collapse into one line.
assert.deepEqual(
  groupPaymentsByMethod([
    { method: "CASH", amount: 500 },
    { method: "CASH", amount: 200 },
  ]),
  [{ method: "CASH", label: "Cash", amount: 700 }]
);

// The API serialises Decimal as a string; summing must be numeric, or a
// 500 + 300 split prints "500300".
assert.deepEqual(
  groupPaymentsByMethod([
    { method: "CASH", amount: "500.00" },
    { method: "CASH", amount: "300.50" },
  ]),
  [{ method: "CASH", label: "Cash", amount: 800.5 }]
);

// Mixed tenders come back in PAYMENT_METHODS order, not insertion order.
const mixed = groupPaymentsByMethod([
  { method: "GPAY", amount: 300 },
  { method: "CASH", amount: 500 },
  { method: "CARD", amount: 100 },
]);
assert.deepEqual(
  mixed.map((row) => row.method),
  ["CASH", "GPAY", "CARD"]
);
assert.equal(
  mixed.reduce((sum, row) => sum + row.amount, 0),
  900
);

// Empty and malformed inputs must not throw or invent rows.
assert.deepEqual(groupPaymentsByMethod([]), []);
assert.deepEqual(groupPaymentsByMethod(), []);
assert.deepEqual(groupPaymentsByMethod(null), []);
assert.deepEqual(groupPaymentsByMethod([{ amount: 100 }]), []);
assert.deepEqual(groupPaymentsByMethod([{ method: "CASH", amount: "abc" }]), []);
// A zero-value row adds no line, but must not hide a real sibling tender.
assert.deepEqual(
  groupPaymentsByMethod([
    { method: "CASH", amount: 0 },
    { method: "UPI", amount: 250 },
  ]),
  [{ method: "UPI", label: "UPI", amount: 250 }]
);

// A refund reversing its own tender leaves no line; other tenders survive.
assert.deepEqual(
  groupPaymentsByMethod([
    { method: "CARD", amount: 400 },
    { method: "CARD", amount: -400 },
    { method: "CASH", amount: 100 },
  ]),
  [{ method: "CASH", label: "Cash", amount: 100 }]
);

// Every option must be selectable and labelled, or a picker renders a blank row.
assert.ok(PAYMENT_METHODS.every((row) => row.value && row.label));
assert.equal(
  new Set(PAYMENT_METHODS.map((row) => row.value)).size,
  PAYMENT_METHODS.length
);

console.log("paymentMethods check passed");
