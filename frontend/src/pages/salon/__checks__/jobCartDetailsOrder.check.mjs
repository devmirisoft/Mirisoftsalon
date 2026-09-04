// Guards against a temporal-dead-zone crash in JobCartDetails, e.g.
// "Cannot access 'payableAmount' before initialization", which only shows up
// when the component body actually executes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../JobCartDetails.jsx", import.meta.url),
  "utf8"
);

// Every const the component body reads must be declared before its first use.
// Checking the two that crashed, plus the rest of the money values the
// confirm handlers depend on.
const declIndex = (name) => src.indexOf("  const " + name + " =");
const firstUseInHandlers = src.indexOf("  const collecting = ");

const deps = [
  "payableAmount",
  "membershipWalletBalance",
  "subtotalAmount",
  "discountTotal",
  "taxAmount",
  "roundOffAmount",
  "packageCoveredAmount",
];

for (const name of deps) {
  const decl = declIndex(name);
  assert.notEqual(decl, -1, name + " is not declared");
  assert.ok(
    decl < firstUseInHandlers,
    name + " is declared after the confirm handlers that read it (TDZ crash)"
  );
}

// The handlers themselves must come after the values, not before.
for (const handler of ["const buildConfirmBody", "const confirm = async"]) {
  assert.ok(
    src.indexOf(handler) > declIndex("payableAmount"),
    handler + " sits above payableAmount"
  );
}

// crypto.randomUUID and new Date must stay inside a callback, never in the
// render path, or the React compiler flags them as impure.
const bodyStart = src.indexOf("const buildConfirmBody = () => ({");
const bodyEnd = src.indexOf("const confirm = async");
const insideBuilder = src.slice(bodyStart, bodyEnd);
assert.ok(insideBuilder.includes("randomUUID()"), "key generated in builder");
assert.ok(insideBuilder.includes("new Date().toISOString()"), "time stamped in builder");

console.log("declaration order ok for " + deps.length + " values; no TDZ");
