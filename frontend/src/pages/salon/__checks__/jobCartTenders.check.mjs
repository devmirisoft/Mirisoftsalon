// Self-check for the split-tender math on the job cart bill.
// Run: node frontend/src/pages/salon/__checks__/jobCartTenders.check.mjs
// Mirrors the tender block in JobCartDetails.jsx.
import assert from "node:assert/strict";

export const summarise = (tenders, payableAmount, walletBalance) => {
  const active = tenders.filter((tender) => tender.method);
  const singleFullTender = active.length === 1 && !active[0].amount;
  // A blank lone tender settles the whole bill, except the wallet, which can
  // only ever settle what it holds.
  const singleFullAmount = !singleFullTender
    ? 0
    : active[0].method === "MEMBERSHIP_WALLET"
      ? Math.min(walletBalance, payableAmount)
      : payableAmount;
  const collectedAmount = singleFullTender
    ? singleFullAmount
    : active.reduce((sum, tender) => sum + Number(tender.amount || 0), 0);
  const walletTender = active.find(
    (tender) => tender.method === "MEMBERSHIP_WALLET"
  );
  return {
    collectedAmount,
    outstandingAfter: Math.max(payableAmount - collectedAmount, 0),
    overpaying: collectedAmount - payableAmount > 0.004,
    walletShort: Boolean(
      walletTender &&
        (singleFullTender
          ? singleFullAmount
          : Number(walletTender.amount || 0)) >
          walletBalance + 0.004
    ),
  };
};

const wallet = (amount = "") => ({ method: "MEMBERSHIP_WALLET", amount });
const cash = (amount = "") => ({ method: "CASH", amount });

// Blank cash tender still means "the whole bill".
assert.deepEqual(summarise([cash()], 1000, 0), {
  collectedAmount: 1000,
  outstandingAfter: 0,
  overpaying: false,
  walletShort: false,
});

// Wallet short of the bill: it pays what it has, the rest waits for a split,
// and that is not an error the operator has to clear.
assert.deepEqual(summarise([wallet()], 1000, 400), {
  collectedAmount: 400,
  outstandingAfter: 600,
  overpaying: false,
  walletShort: false,
});

// Wallet covers the bill: nothing left to split.
assert.deepEqual(summarise([wallet()], 1000, 2500), {
  collectedAmount: 1000,
  outstandingAfter: 0,
  overpaying: false,
  walletShort: false,
});

// Split settles the bill exactly.
assert.deepEqual(summarise([wallet("400"), cash("600")], 1000, 400), {
  collectedAmount: 1000,
  outstandingAfter: 0,
  overpaying: false,
  walletShort: false,
});

// A typed wallet amount is still checked against the balance.
assert.equal(summarise([wallet("500"), cash("500")], 1000, 400).walletShort, true);

// Collecting more than the bill is blocked.
assert.equal(summarise([cash("600"), cash("600")], 1000, 0).overpaying, true);

console.log("jobCartTenders check passed");
