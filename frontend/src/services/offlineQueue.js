// Confirms pressed while the connection is down are parked in localStorage and
// pushed when the browser comes back online. Each carries the idempotencyKey
// and the time the operator actually pressed Confirm, so a replay cannot bill
// twice and the bill keeps the time it was rung up rather than the time it
// finally reached the server.
//
// ponytail: single-tab, serial drain. Two terminals draining the same queue is
// not a correctness problem (the server dedupes on idempotencyKey) but would
// duplicate effort; move to BroadcastChannel if that ever matters.
import { salonApi } from "./salonApi";

const KEY = "salon.jobcart.pendingConfirms";

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

export const pendingConfirms = () => read();

export const enqueueConfirm = (jobCartId, body) => {
  const entries = read().filter(
    (entry) => entry.body?.idempotencyKey !== body.idempotencyKey
  );
  entries.push({ jobCartId, body, queuedAt: new Date().toISOString() });
  write(entries);
};

export const removeConfirm = (idempotencyKey) => {
  write(
    read().filter((entry) => entry.body?.idempotencyKey !== idempotencyKey)
  );
};

/**
 * Pushes every parked confirm. An entry is dropped once the server has taken
 * it, including when the server rejects it outright (4xx): a replay of a bad
 * request will never succeed, so keeping it would block the queue forever.
 * Network failures leave the entry in place for the next attempt.
 */
export const drainConfirms = async () => {
  const entries = read();
  if (!entries.length) return { pushed: 0, remaining: 0 };
  let pushed = 0;
  for (const entry of entries) {
    try {
      await salonApi.jobCarts.confirm(entry.jobCartId, entry.body);
      removeConfirm(entry.body?.idempotencyKey);
      pushed += 1;
    } catch (error) {
      if (error?.status >= 400 && error.status < 500) {
        removeConfirm(entry.body?.idempotencyKey);
        pushed += 1;
        continue;
      }
      break; // still offline: keep this and everything after it queued
    }
  }
  return { pushed, remaining: read().length };
};

/** Drains now if online, and again whenever the connection returns. */
export const startConfirmQueue = (onDrained) => {
  const run = () => {
    if (!navigator.onLine) return;
    drainConfirms().then((result) => {
      if (result.pushed && onDrained) onDrained(result);
    });
  };
  run();
  window.addEventListener("online", run);
  return () => window.removeEventListener("online", run);
};
