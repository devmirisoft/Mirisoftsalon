// CGST + SGST printed on an invoice must always add back up to the GST charged.
import assert from "node:assert/strict";
import { splitGst } from "../../../utils/salonFormat.js";

for (const total of [0, 0.01, 5, 5.01, 12.345, 99.99, 1234.57]) {
  const { cgst, sgst } = splitGst(total);
  assert.equal(
    Math.round((cgst + sgst) * 100),
    Math.round(total * 100),
    `halves must sum to ${total}`
  );
  assert.ok(sgst - cgst <= 0.01 + 1e-9, `halves must be even within a paisa (${total})`);
}
assert.deepEqual(splitGst(5), { cgst: 2.5, sgst: 2.5 });
assert.deepEqual(splitGst(5.01), { cgst: 2.5, sgst: 2.51 });
assert.deepEqual(splitGst(null), { cgst: 0, sgst: 0 });
console.log("invoiceGstSplit.check.mjs ok");
