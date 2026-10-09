import assert from "node:assert/strict";

// Run: node src/services/__checks__/offlineQueue.check.mjs
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};
const KEY = "salon.jobcart.pendingConfirms";

let reloads = 0;
// A fresh module instance over the same storage, as after a page reload.
const load = () => import(`../offlineQueue.js?reload=${reloads++}`);

// Stands in for the API: a cart is found only under its own branch (or no
// branch session at all), an admin's access can be revoked, and a repeated
// idempotencyKey answers with success instead of billing again.
const server = ({ carts, revoked = new Set() }) => {
  const billed = new Map();
  const calls = [];
  const send = async (jobCartId, body, headers) => {
    const branch = headers["X-Branch-Id"];
    calls.push({ jobCartId, branch });
    if (server.offline) throw Object.assign(new Error("offline"), { status: 0 });
    if (branch && revoked.has(branch)) {
      throw Object.assign(new Error("You do not have access to this branch"), { status: 403 });
    }
    if (branch && carts[jobCartId] !== branch) {
      throw Object.assign(new Error("Job cart not found"), { status: 404 });
    }
    // Mirrors confirmJobCart: a key that already billed is answered, not rebilled.
    if (!billed.has(body.idempotencyKey)) billed.set(body.idempotencyKey, 1);
    return { success: true };
  };
  return { send, calls, billed };
};
const body = (key) => ({ idempotencyKey: key, confirmedAt: "2026-10-09T10:00:00Z" });

// Queued in Mohali, switched to Whitefield, reloaded, then replayed.
{
  store.clear();
  (await load()).enqueueConfirm("cart-m", body("key-1"), "mohali");
  // The branch switch only changes the stored session; the queue entry keeps
  // the branch it was pressed in.
  const queue = await load();
  const api = server({ carts: { "cart-m": "mohali" } });
  const result = await queue.drainConfirms(api.send);
  assert.deepEqual(result, { pushed: 1, failed: 0, remaining: 0 });
  assert.deepEqual(api.calls, [{ jobCartId: "cart-m", branch: "mohali" }]);
}

// A confirm pressed under All Branches is replayed with no branch session,
// even though the empty value must override a session opened since.
{
  store.clear();
  const queue = await load();
  queue.enqueueConfirm("cart-w", body("key-2"), null);
  const api = server({ carts: { "cart-w": "whitefield" } });
  await queue.drainConfirms(api.send);
  assert.deepEqual(api.calls, [{ jobCartId: "cart-w", branch: "" }]);
}

// Revoked access: kept as failed, not resent on its own, recoverable by retry.
{
  store.clear();
  const queue = await load();
  queue.enqueueConfirm("cart-m", body("key-3"), "mohali");
  const api = server({ carts: { "cart-m": "mohali" }, revoked: new Set(["mohali"]) });
  assert.deepEqual(await queue.drainConfirms(api.send), { pushed: 0, failed: 1, remaining: 1 });
  const [failed] = queue.failedConfirms();
  assert.equal(failed.failed.status, 403);
  assert.equal(failed.body.idempotencyKey, "key-3");

  await queue.drainConfirms(api.send);
  assert.equal(api.calls.length, 1, "a failed entry is not replayed automatically");

  // The operator retries from All Branches, where they still have access.
  queue.retryConfirm("key-3", null);
  assert.deepEqual(await queue.drainConfirms(api.send), { pushed: 1, failed: 0, remaining: 0 });
  assert.equal(api.calls.at(-1).branch, "");

  // Discard is the only other way out.
  queue.enqueueConfirm("cart-x", body("key-4"), "mohali");
  await queue.drainConfirms(server({ carts: {} }).send);
  assert.equal(queue.failedConfirms().length, 1);
  queue.removeConfirm("key-4");
  assert.equal(queue.pendingConfirms().length, 0);
}

// Still offline: nothing is dropped or marked failed, and draining stops at
// the first entry so order is kept.
{
  store.clear();
  const queue = await load();
  queue.enqueueConfirm("cart-m", body("key-5"), "mohali");
  queue.enqueueConfirm("cart-m2", body("key-6"), "mohali");
  const api = server({ carts: { "cart-m": "mohali", "cart-m2": "mohali" } });
  server.offline = true;
  assert.deepEqual(await queue.drainConfirms(api.send), { pushed: 0, failed: 0, remaining: 2 });
  assert.equal(api.calls.length, 1);
  assert.equal(queue.failedConfirms().length, 0);

  // Expired session and server errors are retried later as well.
  for (const status of [401, 500, 503]) {
    const result = await queue.drainConfirms(async () => {
      throw Object.assign(new Error("later"), { status });
    });
    assert.deepEqual(result, { pushed: 0, failed: 0, remaining: 2 });
  }

  server.offline = false;
  assert.deepEqual(await queue.drainConfirms(api.send), { pushed: 2, failed: 0, remaining: 0 });
}

// Duplicate prevention: re-queuing the same press keeps one entry, and a
// replay after a lost response bills once (the server answers the repeat).
{
  store.clear();
  const queue = await load();
  queue.enqueueConfirm("cart-m", body("key-7"), "mohali");
  queue.enqueueConfirm("cart-m", body("key-7"), "mohali");
  assert.equal(queue.pendingConfirms().length, 1);

  const api = server({ carts: { "cart-m": "mohali" } });
  await api.send("cart-m", body("key-7"), { "X-Branch-Id": "mohali" }); // landed, response lost
  await queue.drainConfirms(api.send);
  assert.equal(api.billed.get("key-7"), 1);
  assert.equal(queue.pendingConfirms().length, 0);
}

// Legacy entries (queued before entries carried a branch) are never sent
// under whatever branch happens to be open; they wait for the operator.
{
  store.clear();
  localStorage.setItem(
    KEY,
    JSON.stringify([{ jobCartId: "cart-w", body: body("key-8"), queuedAt: "2026-10-01T00:00:00Z" }])
  );
  const queue = await load();
  const api = server({ carts: { "cart-w": "whitefield" } });
  assert.deepEqual(await queue.drainConfirms(api.send), { pushed: 0, failed: 1, remaining: 1 });
  assert.equal(api.calls.length, 0);
  assert.equal(queue.failedConfirms()[0].failed.message, queue.LEGACY_ENTRY_MESSAGE);

  queue.retryConfirm("key-8", "whitefield");
  assert.deepEqual(await queue.drainConfirms(api.send), { pushed: 1, failed: 0, remaining: 0 });
  assert.deepEqual(api.calls, [{ jobCartId: "cart-w", branch: "whitefield" }]);
}

console.log("offlineQueue ok");
