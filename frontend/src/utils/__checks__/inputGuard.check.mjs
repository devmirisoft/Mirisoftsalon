import assert from "node:assert/strict";
import { cleanInput } from "../inputGuard.js";

assert.equal(cleanInput("text", "Riya Sharma", 0), "Riya Sharma");
assert.equal(cleanInput("text", "Flat 4-B, M.G. Road/2 (Rear) & Co's", 0), "Flat 4-B, M.G. Road/2 (Rear) & Co's");
assert.equal(cleanInput("text", "hi!@#$%^*<>{}[]|\\~`=+;:\"?_", 0), "hi");
assert.equal(cleanInput("text", "राम", 0), "राम");
assert.equal(cleanInput("tel", "+91 98765-43210", 10), "9198765432");
assert.equal(cleanInput("tel", "98765 43210", 10), "9876543210");
assert.equal(cleanInput("tel", "5", 0), "");
assert.equal(cleanInput("tel", "a", 5), "");
console.log("inputGuard ok");
