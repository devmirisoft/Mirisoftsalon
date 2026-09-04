// Self-check for the "+" add-customer rules on the job cart form.
// Run: node frontend/src/pages/salon/__checks__/customerAdd.check.mjs
// Mirrors existingPhoneCustomer + the "+" gate in JobCartCreate.jsx.
import assert from "node:assert/strict";

const digits = (value) => String(value ?? "").replace(/\D/g, "");

export const findPhoneOwner = (customers, phone) => {
  const typed = digits(phone);
  if (typed.length !== 10) return null;
  return (
    customers.find((customer) => {
      const stored = digits(customer.phone);
      return stored.length >= 10 && stored.endsWith(typed);
    }) || null
  );
};

export const canAddCustomer = (customers, phone, name) =>
  !findPhoneOwner(customers, phone) &&
  Boolean(name.trim()) &&
  digits(phone).length === 10;

const customers = [
  { name: "Asha", phone: "+919876543210" },
  { name: "Ravi", phone: "9123456780" },
];

// New name on an unused number: addable.
assert.equal(canAddCustomer(customers, "9000000001", "Neha"), true);
// Name already taken but the number is free: still addable.
assert.equal(canAddCustomer(customers, "9000000001", "Asha"), true);
// Number belongs to Asha, different name: blocked.
assert.equal(canAddCustomer(customers, "9876543210", "Someone Else"), false);
// Same number, same name: blocked, already a customer.
assert.equal(canAddCustomer(customers, "9876543210", "Asha"), false);
// Fewer than 10 digits: blocked.
assert.equal(canAddCustomer(customers, "98765", "Neha"), false);
// Blank name: blocked.
assert.equal(canAddCustomer(customers, "9000000001", "   "), false);
// A number stored without a country code still resolves its owner.
assert.equal(findPhoneOwner(customers, "9123456780")?.name, "Ravi");

console.log("customer add rules: all assertions passed");
