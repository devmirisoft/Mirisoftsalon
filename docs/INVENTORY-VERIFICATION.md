# Inventory Verification & Hardening Report

Scope: location-based inventory, open-container tracking, service usage, transfers,
reconciliation, Job Cart and retail integration.
Method: read the implementation and the tests first, then verify every claim against
code and against the rows the code writes. The earlier implementation report was
treated as a claim, not as evidence.

All database work in this pass ran against local databases (`salon_test`,
`salon_e2e`, and a throwaway schema `migration_check_<rand>`). The remote database
in `backend/.env` was not written to.

---

## 1. Invariants

### 1.1 `Product.currentStock == Σ ProductLocationStock.quantity`

`currentStock` is **the number of whole packs the salon holds, wherever they are,
including packs that are open and partly used**. A 1000 ml bottle counts as one unit
of stock from the moment it is received until it is emptied, lost or damaged — not
from purchase until it is opened.

`ProductLocationStock` holds the same number split by site and location, where
`siteKey = branchId ?? "SALON"` and `location ∈ {WAREHOUSE, RETAIL, SERVICE}`.
`ProductContainer.remainingQuantity` is a *different* ledger, measured in the
container unit (ml, g), and is deliberately **not** part of this invariant: content
inside an open pack is not a pack.

The invariant is enforced structurally, not by convention:

- `createStockMovement()` in [stockMovement.service.ts](../backend/src/features/stock/stockMovement.service.ts)
  is the **only** writer of `Product.currentStock` in the backend
  (`features/stock/stockMovement.service.ts:434`, `data: { currentStock: { increment: delta } }`).
  A repository-wide grep for assignments to `currentStock` outside generated Prisma
  code finds no other write path — no controller, no purchase flow, no seed path in
  `src/` writes it directly.
- The same function writes the matching `ProductLocationStock` row in the same
  transaction, so a movement cannot change one side without the other.
- Movements that take stock out use a conditional `updateMany(... quantity >= x)`,
  so a balance can never be driven negative by a race.

Verified by test after: purchase, manual adjustment, warehouse→retail,
warehouse→service, branch transfer, salon→branch transfer, opening a container,
service usage, usage split across two containers, retail sale, wastage, loss,
reconciliation, appointment cancellation, and job cart cancellation
(`inventory-verification.test.ts` → "stock invariant holds after every kind of stock
event" and "keeps a job cart cancellation consistent").

### 1.2 Pack ledger vs content ledger

| Ledger | Rows | Unit |
| --- | --- | --- |
| Packs | `STOCK_IN`, `TRANSFER`, `RETAIL_SALE`, `ADJUSTMENT` without `containerId`, `WASTAGE`/`LOST`/`DAMAGED` without `containerId`, `OPEN_CONTAINER`, `CONTAINER_CLOSED` | product unit (`Product.unit`) |
| Contents | `USED_IN_SERVICE`, `RETURNED`, and `WASTAGE`/`LOST`/`DAMAGED`/`ADJUSTMENT` carrying a `containerId` | container unit (`Product.packUnit` at the time) |

Every movement now records the unit it was measured in
(`ProductStockMovement.unit`), so the two ledgers stay separable for ever.

---

## 2. Defects found and fixed

### 2.1 Opening a container consumed stock (§2) — **confirmed defect**

`openContainers()` wrote an `OPEN_CONTAINER` movement with `quantity: -1`, so opening
one of five bottles left `currentStock = 4` and `SERVICE = 4` while a container
holding 1000 ml also existed. Physical inventory was under-reported by exactly the
open packs, and the invariant in §1.1 was only true because the pack had been
deleted from stock.

Fix — [productContainer.service.ts](../backend/src/features/stock/productContainer.service.ts):

```ts
type: "OPEN_CONTAINER",
quantity: 1,
// Nothing leaves stock here: the pack is now open rather than sealed.
stockBefore: stock,
stockAfter: stock,
```

The pack stays in `SERVICE` while it is open. It leaves stock only when the container
stops being usable, through a new movement type `CONTAINER_CLOSED` written by
`releasePack()` when a container moves `OPEN → EMPTY | LOST | DAMAGED`; the reverse
transition (`EMPTY → OPEN`, used by reconciliation and by cancellation reversal)
writes a `RETURNED` pack row through `reclaimPack()`. Opening 5 → 1 open leaves
4 sealed + 1 open container of 1000 ml, `currentStock` 5, `SERVICE` 5,
`sealedService` 4.

Consequence that had to be fixed with it: with the pack still in stock, an open pack
could have been transferred out, sold or written off as if it were sealed.
`assertSealedAvailable()` now guards every non-`CONTAINER_CLOSED` outflow from
`SERVICE`:

```ts
const sealed = (balance?.quantity ?? 0).minus(openContainers);
if (sealed.lessThan(needed)) throw insufficientStock(...);
```

### 2.2 Historical quantities were re-read with the current pack size (§3) — **confirmed defect**

Insights multiplied pack-level movements by `Product.packSize` as it is *now*. A
product that was stocked in 500 ml bottles and is later stocked in 1000 ml bottles had
its whole history restated, and a service that used "50" could not be proved to have
been 50 ml rather than 50 units.

Fixes:

1. New column `ProductStockMovement.unit ProductUnit?` — the unit the row was
   measured in, written on every new movement. Documented in the schema:

   > Unit quantity, stockBefore, stockAfter and expectedQuantity are in, as it was
   > when the movement happened: the container unit for a movement inside an opened
   > pack, the product unit otherwise. Older rows have none and are read as the
   > product unit of their time.

2. Insights sum only the rows recorded in the current usage unit
   (`COALESCE(m."unit"::text, product.unit) = usageUnit`) and report the rest
   separately as `movementsInOtherUnits`, instead of silently converting them.
3. `PUT /api/products/:id` refuses to change `packUnit`/`packSize` on a product with
   history unless the caller passes `confirmConsumableUnits: true`, answering `409
   CONSUMABLE_UNIT_CHANGE` otherwise, and rejects `packUnit === unit` outright.

**Where setting pack fields can still reinterpret history:** the numbers already
written stay exactly as they were, but a product that had *no* pack tracking and gains
it later has legacy rows with `unit = NULL`. Those are read as the product unit of
their time — which is the truth for pack rows, and is unknowable for any historical
service usage recorded before containers existed. Such rows are excluded from
container analytics rather than converted.

### 2.3 Expected quantity was double counted across containers (§4) — **confirmed defect**

When one service line pulled 50 ml from two containers, the insights query summed
`expectedQuantity` per movement row, so a 50 ml expectation split over two packs
reported as 100 expected vs 50 actual — a phantom saving on every split usage.

Fix — `MAX(m."expectedQuantity")` grouped by service line, so expected is per line and
actual is the sum of the allocations. Verified: split usage of 50 ml over two
containers reports expected 50, actual 50, variance 0.

### 2.4 Reconciliation variance had a mixed sign (§8) — **confirmed defect**

`foundOnReconciliation` added the absolute movement quantity regardless of direction,
so a count that found *less* than the system expected was reported as if stock had
been found. Fix — a signed variance:

```sql
SUM(CASE WHEN m."type" = 'ADJUSTMENT' THEN m."quantity" ELSE -m."quantity" END)
  FILTER (WHERE m."referenceType" = 'RECONCILE')
```

### 2.5 Cancellation reversal could fail or corrupt a container (§7) — **confirmed defect**

Restoring usage into a container that had since been refilled threw
("holds at most X"), which failed the whole cancellation; restoring into a container
that had been written off as `LOST`/`DAMAGED` silently put content back into a pack
that no longer exists.

Fix — a written policy, implemented in
[appointmentConsumableReversal.service.ts](../backend/src/features/stock/appointmentConsumableReversal.service.ts):

| Container state at cancellation | Behaviour |
| --- | --- |
| Still `OPEN`, used again since | Content goes back into the same container; later usage is untouched. |
| `EMPTY` | Container is reopened (`EMPTY → OPEN`), pack reclaimed via a `RETURNED` pack row, content restored. |
| Another container opened since | Restored into the original container, not the newest one. |
| Reconciled since (capacity now smaller than the restore) | Restores only what fits, up to capacity, and records the shortfall in the movement reason. Never creates more content than the pack can hold. |
| `LOST` / `DAMAGED` | Not touched. The cancellation still succeeds, the skip is counted (`skipped`) and written to the audit log with the container code and reason. |

The policy never creates impossible quantities (restore is capped by capacity), never
silently loses the record (every restore or skip is a movement or an audit entry), and
never blocks a cancellation.

### 2.6 Reconciliation overwrote without a record (§8) — **fixed**

A reconciliation now writes, in one transaction: the previous calculated amount
(`stockBefore` on the movement and `previousQuantity` in the audit payload), the
counted physical amount (`stockAfter`), the signed variance (movement `quantity`), the
free-text reason, the acting user and the timestamp. It writes `ADJUSTMENT` with
`referenceType = "RECONCILE"`, which is a different reference type from operator-known
wastage (`WASTAGE`/`LOST`/`DAMAGED` with a reason), so insights report "counted
difference" and "known wastage" as separate lines. **Nothing auto-classifies a
discrepancy as employee wastage** — the reconciliation reason is whatever the operator
typed, and no code path converts a variance into a wastage row.

### 2.7 A container from another product could be used (§5/§6) — **fixed**

Usage allocation now checks that each allocated container belongs to the product being
consumed and is `OPEN`, rejecting the request otherwise.

---

## 3. Behaviour verified, not changed

- **Container allocation is persisted server-side** (§6). With container A at 20/1000
  and B at 1000/1000, a 50 ml usage leaves A at 0 `EMPTY` and B at 970 `OPEN`, with
  two `USED_IN_SERVICE` rows (20 and 30) carrying the container ids — asserted from
  the database, not from the frontend helper `utils/usageAllocation.js`.
- **Per-service traceability** (§5). Two lines of one appointment using the same
  product reconstruct independently from `ProductStockMovement`:
  `appointmentId`, `appointmentServiceId`, `serviceId`, `productId`,
  `expectedQuantity`, actual `quantity`, `staffId` (performer),
  `receivedByStaffId`/`createdById` (recorder), `containerId`, `branchId`, `unit`,
  `createdAt`.
- **Transfers**: salon-level (`siteKey = "SALON"`) stock can be moved into a branch;
  a transfer between two branches is rejected, and a failed or rejected transfer
  leaves both balances untouched.
- **Retail** sells from `RETAIL` only; an empty shelf offers a warehouse transfer
  rather than quietly selling warehouse stock.

---

## 4. RBAC matrix (verified at the API)

`requireRole` treats `BRANCH_MANAGER` as a `SALON_ADMIN` confined to one branch, so a
manager inherits every `SALON_ADMIN` grant and is then limited to its own branch by
the branch-scope helpers.

| Operation (endpoint) | SUPER_ADMIN | SALON_ADMIN | BRANCH_MANAGER | RECEPTIONIST | STAFF |
| --- | --- | --- | --- | --- | --- |
| View inventory (`GET /api/inventory/products/:id`) | ✅ | ✅ | ✅ own branch | ✅ own branch | ✅ own branch, service area |
| Transfer stock (`POST /api/inventory/transfers`) | ✅ any salon | ✅ | ✅ own branch | ✅ own branch | ✅ own branch |
| Open a container (`POST /api/inventory/containers/open`) | ✅ | ✅ | ✅ own branch | ✅ own branch | ✅ own branch |
| Record service usage (`PATCH /api/appointments/:id/status`) | ✅ | ✅ | ✅ own branch | ✅ own branch | ✅ own branch |
| Retail sale / bill (`POST /api/job-carts/:id/confirm`) | ✅ | ✅ | ✅ own branch | ✅ own branch | ❌ 403 |
| Reconcile a container (`POST /api/inventory/containers/:id/reconcile`) | ✅ | ✅ | ✅ own branch | ❌ 403 | ❌ 403 |
| Manual wastage/loss (`POST /api/stock-movements/manual`) | ✅ | ✅ | ✅ own branch | ❌ 403 | ❌ 403 |

Cross-tenant: every inventory endpoint resolves the salon from the session
(`getSalonId`), so a salon admin of salon A gets 404/403 on salon B's product,
container and appointment ids; `SUPER_ADMIN` must name the salon explicitly.
Branch-locked writes ignore a `branchId` in the body and are pinned to the caller's
branch (`writableBranch`).

---

## 5. Concurrency, idempotency and rollback

All exercised with real parallel HTTP requests against the test server, then the
database was read back.

| Scenario | Expected | Result |
| --- | --- | --- |
| 5 in the warehouse, two 4-unit transfers at once | one succeeds, one 400 | ✅ warehouse 1, no negative balance |
| One 50 ml container, two 40 ml usages at once | one succeeds, one fails | ✅ 10 ml left, one `USED_IN_SERVICE` row |
| Last retail unit, two sales at once | one sells | ✅ shelf 0, one `RETAIL_SALE` |
| Same transfer / open / reconcile submitted twice (sequential and simultaneous) | applied once | ✅ one movement each |
| Appointment completion submitted twice | usage booked once | ✅ |
| Job cart confirm submitted twice | bill and usage once | ✅ |
| Payment rejected during confirm | no stock change | ✅ balances and containers unchanged |
| Second container allocation rejected mid-usage | first container untouched | ✅ |
| Audit write forced to fail | whole movement rolled back | ✅ no movement, no balance change |

Locking: `SELECT ... FOR UPDATE` on the `Product` row inside the same transaction that
writes the movement, plus conditional `updateMany` on `ProductLocationStock` and
`ProductContainer` (`... WHERE quantity >= x`), so the loser of a race gets a
rejection rather than a negative balance. There is no separate advisory-lock path and
no optimistic retry loop.

---

## 6. Migration and backfill audit

Migration `20260922090000_add_inventory_locations_and_containers`, replayed from an
empty database through the full migration history into a throwaway schema, with legacy
rows inserted before it runs.

Backfill rule: `isRetailProduct → RETAIL`, else `isServiceConsumable → SERVICE`, else
`WAREHOUSE`; `siteKey = COALESCE(branchId, 'SALON')`; only products with
`currentStock <> 0` get a row.

| Legacy shape | Lands in | Note |
| --- | --- | --- |
| Retail only, branch, 12.5 | `RETAIL` 12.50 at that branch | |
| Consumable only, branch, 40 | `SERVICE` 40.00 | |
| Both flags, branch, 99 | `RETAIL` 99.00 | **ambiguous** — see below |
| Neither flag, branch, 30 | `WAREHOUSE` 30.00 | |
| Retail, salon-wide (`branchId NULL`), 8 | `RETAIL` 8.00, `siteKey = 'SALON'` | |
| Consumable, salon-wide (`branchId NULL`), 6 | `SERVICE` 6.00, `siteKey = 'SALON'` | |
| Stock 0 | no row | a zero balance is not a location |
| Negative (−3) | `RETAIL` −3.00 | carried across as it stands, not corrected |
| Pre-location movements | unchanged; `location`, `containerId`, `unit` stay `NULL` | read as the product unit of their time |

Products carrying **both** flags have no historical location: the salon knew only that
the product was sold *and* used. The backfill puts them on the retail shelf because
that is where a salable product is counted, and the migration does not pretend to know
more. The operator query for the rows to check by hand is in the migration test:

```sql
SELECT p."id" FROM "Product" p
JOIN "ProductLocationStock" s ON s."productId" = p."id"
WHERE p."isRetailProduct" AND p."isServiceConsumable"
GROUP BY p."id" HAVING COUNT(*) = 1;
```

Asserted after the migration: every product row and every movement row is byte-for-byte
unchanged, no product's `currentStock` differs from the sum of its location rows, and
no stock disappears.

---

## 7. Test results

<!--RESULTS-->

---

## 8. Files changed in this pass

Backend
- `prisma/schema.prisma` — `ProductStockMovement.unit`, `CONTAINER_CLOSED`
- `prisma/migrations/20260922090000_add_inventory_locations_and_containers/migration.sql`
- `src/features/stock/productContainer.service.ts` — open/close pack accounting
- `src/features/stock/stockMovement.service.ts` — `assertSealedAvailable`, unit on every row
- `src/features/stock/serviceUsage.service.ts` — container ownership check
- `src/features/stock/appointmentConsumableReversal.service.ts` — reversal policy
- `src/features/inventory/inventory.controller.ts` — unit-aware insights, `sealedService`, signed reconciliation variance
- `src/features/products/product.controller.ts` — pack-unit change confirmation
- `src/config/prisma.ts`, `src/tests/setup.ts`, `jest.config.ts`, `package.json` — test-run fixes

Frontend
- `src/components/salon/ProductForms.jsx`, `ProductInventoryPanel.jsx`, `InventoryModals.jsx`
- `src/pages/salon/ProductDetail.jsx`

Tests
- `backend/src/__tests__/inventory-verification.test.ts` (new)
- `backend/src/__tests__/inventory-migration.test.ts` (rewritten)
- `backend/src/__tests__/inventory-locations.test.ts` (updated to the corrected semantics)
- `frontend/e2e/inventory-1-locations.spec.js`, `inventory-2-flows.spec.js` (new), `helpers.js`, `global-setup.js`
- `backend/scripts/seed-e2e-inventory.ts`

---

## 9. Commands

```bash
# backend unit + integration (single invocation)
cd backend && npm test

# one suite
cd backend && npx dotenv -e .env.test -- node --experimental-vm-modules \
  node_modules/jest/bin/jest.js src/__tests__/inventory-verification.test.ts

# browser suite (seeds salon_e2e, builds the frontend, serves it with vite preview)
cd frontend && npx playwright test
```

`.env.test` points at local `salon_test`; the Playwright global setup points at local
`salon_e2e` and refuses to reset any database whose name does not contain `e2e`.

---

## 10. Production Readiness Risks

1. **Ambiguous legacy placement.** Products flagged both retail and consumable are
   backfilled onto the retail shelf. For a salon that kept such products in the
   service area, the first service after the migration will report a shortfall and ask
   for a transfer. Run the ambiguity query in §6 before go-live and move those
   balances deliberately.
2. **Legacy movements have no unit.** Rows written before this pass carry
   `unit = NULL` and are read as the product unit of their time. Container analytics
   exclude them (`movementsInOtherUnits` counts them), so "usage this month" is
   complete only from the migration date onwards.
3. **Unit provenance depends on one writer.** `unit` is nullable and there is no
   database constraint behind it; provenance holds because `createStockMovement` is
   the only writer of stock. A future code path that inserts movements directly would
   silently reintroduce 2.2.
4. **Idempotency is advisory, not a constraint.** Duplicate suppression is a lookup on
   (`salonId`, `productId`, `type`, `referenceType`, `referenceId`, `containerId`,
   `appointmentServiceId`) plus the client `requestId`, serialised by the `Product`
   row lock — not a unique index. Two *legitimately different* records with the same
   key (a second, separate usage of the same product on the same service line; the
   same manual wastage entered twice on purpose) are swallowed as duplicates. Adding a
   partial unique index would make this structural.
5. **Write throughput on a hot product.** Every stock write takes `FOR UPDATE` on the
   product row, so concurrent bills touching the same product serialise. This is
   correct but it is a ceiling: there is no deadlock retry and no queue. A salon with
   heavy simultaneous billing on one product will see waits, and under a long
   transaction a lock wait can surface as a request timeout.
6. **Reopening an emptied pack.** A reconciliation that finds content in a container
   marked `EMPTY` reopens it and takes the pack back into stock. If the physical pack
   was actually discarded, stock is overstated until the next count. The movement
   trail shows it, nothing blocks it.
7. **Reversal of usage from a written-off pack.** Cancelling an appointment whose
   content came from a pack later marked `LOST`/`DAMAGED` does not restore the
   content (correct — it no longer exists), so the bill reverses while the stock does
   not. The skip is recorded in the audit log only; it is not surfaced in the UI.
8. **Negative balances are carried over.** Products that were already oversold arrive
   with a negative location balance and stay negative until reconciled. Insights and
   low-stock lists will show them.
9. **The migration has not been run against production.** It was verified only by
   replaying the full history into a throwaway local schema. Adding the nullable
   `unit` column and the new enum values is metadata-only, but the backfill runs an
   `INSERT … SELECT` over the whole `Product` table inside the migration transaction;
   time it against a production-sized copy first.
10. **Expected quantities depend on the service→product mapping.** A service with no
    mapped consumables produces no expectation, so the variance analytics are blind
    to it — absence of a discrepancy is not proof that nothing was used.
11. **Concurrency evidence is two-way, not load.** The races were proven with pairs of
    simultaneous requests on one Postgres instance. Nothing here is evidence about
    sustained load, connection-pool exhaustion or multi-instance deployment.
12. **Browser coverage is Chromium only**, one viewport, one machine, with the app
    served by `vite preview`. Mobile layout and other engines are untested.
