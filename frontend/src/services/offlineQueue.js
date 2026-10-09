// Confirms pressed while the connection is down are parked in localStorage and
// pushed when the browser comes back online. Each carries the idempotencyKey
// and the time the operator actually pressed Confirm, so a replay cannot bill
// twice and the bill keeps the time it was rung up rather than the time it
// finally reached the server.
//
// Each entry also keeps the branch session the page was working in, and is
// replayed under that branch rather than whichever one is open by the time the
// connection returns, so a branch switch in between cannot turn a good confirm
// into a "not found". The server still checks that branch against the caller's
// access at replay time; nothing here widens it.
//
// An entry leaves the queue only once the server has taken it, or when the
// operator discards it. A rejection is kept as failed, shown on the job cart
// page, and waits for the operator to retry or discard it.
//
// ponytail: single-tab, serial drain. Two terminals draining the same queue is
// not a correctness problem (the server answers a repeated idempotencyKey with
// the already-billed cart) but would duplicate effort; move to
// BroadcastChannel if that ever matters.

const KEY = "salon.jobcart.pendingConfirms";

export const LEGACY_ENTRY_MESSAGE =
  "Saved before bills recorded their branch. Open the branch this bill belongs to and retry it.";

const read = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
};

const write = (entries) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // A full or unavailable localStorage must not break billing; the caller
    // still surfaces the original network error.
  }
};

const keyOf = (entry) => entry.body?.idempotencyKey;

const update = (idempotencyKey, change) =>
  write(
    read().map((entry) =>
      keyOf(entry) === idempotencyKey ? change(entry) : entry
    )
  );

export const pendingConfirms = () => read();

export const failedConfirms = () => read().filter((entry) => entry.failed);

/** `branchId` is the branch session the page is open on; null for all branches. */
export const enqueueConfirm = (jobCartId, body, branchId) => {
  const entries = read().filter(
    (entry) => keyOf(entry) !== body.idempotencyKey
  );
  entries.push({
    jobCartId,
    body,
    branchId: branchId || null,
    queuedAt: new Date().toISOString(),
  });
  write(entries);
};

export const removeConfirm = (idempotencyKey) => {
  write(read().filter((entry) => keyOf(entry) !== idempotencyKey));
};

/**
 * Puts a failed entry back in line under the branch the operator has open
 * now (null for all branches): the original one may be the reason it failed,
 * e.g. access to it was revoked. The server re-checks access on the replay.
 */
export const retryConfirm = (idempotencyKey, branchId) =>
  update(idempotencyKey, ({ failed: _failed, ...entry }) => ({
    ...entry,
    branchId: branchId || null,
  }));

// No connection, an expired session or a busy server: worth trying again
// later, so the entry stays queued as it is.
const isTransient = (error) => {
  const status = error?.status ?? 0;
  return (
    status === 0 ||
    status === 401 ||
    status === 408 ||
    status === 429 ||
    status >= 500
  );
};

// An empty value overrides the stored session, so a confirm pressed under all
// branches is not replayed inside a branch opened since.
const branchHeaders = (entry) => ({ "X-Branch-Id": entry.branchId ?? "" });

/**
 * Pushes every parked confirm through `send(jobCartId, body, headers)`.
 *
 * - accepted: removed.
 * - transient failure: kept, and draining stops (still offline).
 * - rejected (any other 4xx): kept and marked failed, never replayed again on
 *   its own. The server answers a confirm that already landed with success
 *   (same idempotencyKey), so a rejection here is a real one.
 * - queued before entries carried a branch: marked failed without sending,
 *   since its branch is unknown and the open one may be unrelated.
 */
export const drainConfirms = async (send) => {
  let pushed = 0;
  let failed = 0;
  for (const entry of read()) {
    if (entry.failed) continue;
    const idempotencyKey = keyOf(entry);
    const at = new Date().toISOString();
    if (!("branchId" in entry)) {
      update(idempotencyKey, (current) => ({
        ...current,
        failed: { status: null, message: LEGACY_ENTRY_MESSAGE, at },
      }));
      failed += 1;
      continue;
    }
    try {
      await send(entry.jobCartId, entry.body, branchHeaders(entry));
      removeConfirm(idempotencyKey);
      pushed += 1;
    } catch (error) {
      if (isTransient(error)) break;
      update(idempotencyKey, (current) => ({
        ...current,
        failed: {
          status: error.status,
          message: error.message || "The server rejected this bill.",
          at,
        },
      }));
      failed += 1;
    }
  }
  return { pushed, failed, remaining: read().length };
};

/** Drains now if online, and again whenever the connection returns. */
export const startConfirmQueue = (send, onDrained) => {
  const run = () => {
    if (!navigator.onLine) return;
    drainConfirms(send).then((result) => {
      if ((result.pushed || result.failed) && onDrained) onDrained(result);
    });
  };
  run();
  window.addEventListener("online", run);
  return () => window.removeEventListener("online", run);
};
