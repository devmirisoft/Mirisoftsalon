// Self-check for the numbered-page window in ServerPagination.jsx.
// Run: node frontend/src/components/salon/__checks__/pageWindow.check.mjs
import assert from "node:assert/strict";

export const pageWindow = (page, total) => {
  if (total <= 7) return [...Array(total)].map((_, index) => index + 1);
  const start = Math.max(1, Math.min(page - 2, total - 4));
  const window = [...Array(5)].map((_, index) => start + index);
  const last = window[window.length - 1];
  return [
    ...(start > 2 ? [1, "…"] : start > 1 ? [1] : []),
    ...window,
    ...(last < total - 1 ? ["…", total] : last < total ? [total] : []),
  ];
};

// Small sets list every page, no gaps.
assert.deepEqual(pageWindow(1, 1), [1]);
assert.deepEqual(pageWindow(3, 7), [1, 2, 3, 4, 5, 6, 7]);

// Near the start: window pinned to 1, one gap before the last page.
assert.deepEqual(pageWindow(1, 12), [1, 2, 3, 4, 5, "…", 12]);
assert.deepEqual(pageWindow(3, 12), [1, 2, 3, 4, 5, "…", 12]);

// Middle: gaps on both sides, current page centred.
assert.deepEqual(pageWindow(6, 12), [1, "…", 4, 5, 6, 7, 8, "…", 12]);

// Near the end: window pinned to the last page, no trailing duplicate.
assert.deepEqual(pageWindow(12, 12), [1, "…", 8, 9, 10, 11, 12]);
assert.deepEqual(pageWindow(11, 12), [1, "…", 8, 9, 10, 11, 12]);

// A page adjacent to the ends renders the neighbour, never a one-page gap.
assert.deepEqual(pageWindow(4, 9), [1, 2, 3, 4, 5, 6, "…", 9]);
assert.deepEqual(pageWindow(6, 9), [1, "…", 4, 5, 6, 7, 8, 9]);

// Every entry is either a page in range or the ellipsis marker.
for (let total = 1; total <= 30; total += 1) {
  for (let page = 1; page <= total; page += 1) {
    const entries = pageWindow(page, total);
    assert.ok(entries.includes(page), `page ${page}/${total} missing`);
    assert.ok(entries.includes(1) && entries.includes(total));
    for (const entry of entries) {
      assert.ok(entry === "…" || (entry >= 1 && entry <= total));
    }
    const numbers = entries.filter((entry) => entry !== "…");
    assert.equal(new Set(numbers).size, numbers.length, "duplicate page");
  }
}

console.log("pageWindow check passed");
