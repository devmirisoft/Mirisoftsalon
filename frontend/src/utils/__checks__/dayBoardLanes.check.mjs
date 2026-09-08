// Lane packing decides whether a double-booked slot is visible at all, so it
// gets a real check.
import assert from "node:assert/strict";
import { withLanes } from "../dayBoardLanes.js";

const lanesOf = (items) =>
  withLanes(items).map((item) => [item.top, item.lane, item.lanes]);

// Sequential blocks reuse one lane.
assert.deepEqual(
  lanesOf([
    { top: 0, height: 30 },
    { top: 30, height: 30 },
  ]),
  [
    [0, 0, 1],
    [30, 0, 1],
  ]
);

// Overlapping blocks split the column, in start order.
assert.deepEqual(
  lanesOf([
    { top: 40, height: 30 },
    { top: 0, height: 60 },
  ]),
  [
    [0, 0, 2],
    [40, 1, 2],
  ]
);

// A third block reuses the freed lane instead of adding a new one.
assert.deepEqual(
  lanesOf([
    { top: 0, height: 60 },
    { top: 30, height: 60 },
    { top: 90, height: 30 },
  ]),
  [
    [0, 0, 2],
    [30, 1, 2],
    [90, 0, 2],
  ]
);

assert.deepEqual(withLanes([]), []);
console.log("dayBoardLanes checks passed");
