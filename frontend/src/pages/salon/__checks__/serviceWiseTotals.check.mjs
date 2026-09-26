// Self-check for the service-wise record's totals, average and share.
// Run: node frontend/src/pages/salon/__checks__/serviceWiseTotals.check.mjs
// Mirrors serviceWiseTotals + serviceWiseRow in SalesReport.jsx, which read the
// serviceWise rows built by getSalesDashboard in
// backend/src/features/reports/salon-report.controller.ts.
import assert from "node:assert/strict";

export const serviceWiseTotals = (rows) =>
  rows.reduce(
    (totals, row) => ({
      units: totals.units + (row.count ?? 0),
      amount: totals.amount + (row.amount ?? 0),
    }),
    { units: 0, amount: 0 }
  );

export const serviceWiseRow = (row, totalAmount) => ({
  average: row.count ? row.amount / row.count : 0,
  share: totalAmount ? (row.amount / totalAmount) * 100 : 0,
});

const rows = [
  { name: "Hair cut", count: 4, amount: 2000 },
  { name: "Head massage", count: 2, amount: 1000 },
  { name: "Comped trial", count: 1, amount: 0 },
];

const totals = serviceWiseTotals(rows);
assert.deepEqual(totals, { units: 7, amount: 3000 });

// Average is per unit sold, share is of service revenue only.
// The table renders share to one decimal, so that is what is asserted.
const shown = (row) => {
  const { average, share } = serviceWiseRow(row, totals.amount);
  return { average, share: share.toFixed(1) };
};
assert.deepEqual(shown(rows[0]), { average: 500, share: "66.7" });
assert.deepEqual(shown(rows[1]), { average: 500, share: "33.3" });

// A free line divides by neither its own count of zero value nor the total.
assert.deepEqual(shown(rows[2]), { average: 0, share: "0.0" });

// An empty period must not divide by zero.
const empty = serviceWiseTotals([]);
assert.deepEqual(empty, { units: 0, amount: 0 });
assert.deepEqual(serviceWiseRow({ count: 0, amount: 0 }, empty.amount), {
  average: 0,
  share: 0,
});

console.log("serviceWiseTotals checks passed");
