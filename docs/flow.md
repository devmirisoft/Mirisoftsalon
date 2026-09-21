# App Workflow

How the salon app works end to end: who does what, and what the system does behind each step.

Stack: Express + Prisma (Postgres) backend under `backend/src/features/*`, React + Vite frontend under `frontend/src/pages/salon/*`. All API routes are mounted in `backend/src/routes/index.ts`.

---

## 1. Tenancy and roles

```
Salon (tenant: GST settings, membership rules)
 └── Branch (almost every record is branch-scoped)
      └── Staff / Customers / Appointments / Stock / Expenses
```

| Role | Typical use |
|---|---|
| `SUPER_ADMIN` | Everything, across salons |
| `SALON_ADMIN` | Owner: catalogue, pricing, settings, reports, cancellations |
| `BRANCH_MANAGER` | Branch reports, inventory views, salary slips, leaves |
| `RECEPTIONIST` | Front desk: appointments, job carts, billing, retail sales |
| `STAFF` | Own appointments, job carts, attendance, own salary slips |

The backend guards routes with `authenticate` + `requireRole(...)`. The frontend guards pages with `<RoleRoute roles=[...]>` in `frontend/src/route/Index.jsx`.

## 2. Login

```
Login.jsx ──POST /auth/login──► JWT access token + refresh cookie (UserSession row)
          ◄─ GET /auth/me ────  user, role, salonId, branchId
Token expiry ──POST /auth/refresh──► new token     Logout ──POST /auth/logout
```
- Login is rate-limited. There is no backend for forgot-password yet (`ForgotPassword.jsx` has no route behind it).

## 3. One-time setup (admin)

1. **Salon settings**: GST on/off, service and product GST rates, GSTIN, and the membership discount rules `membershipDiscountOnPackages` and `stackMembershipDiscount`.
2. **Branches**, **Staff** (users + `StaffSalaryConfig`), **Staff availability / roster / time blocks** (`ShiftRoster.jsx`).
3. **Catalogue**: Main services → Services (price, duration) → Service consumables (products each service uses up).
4. **Products**: brands, products, vendors (`admin/products`, `admin/vendors`).
5. **Retention**: Memberships (price, discount %, wallet credit, duration), Packages (bundles of services with validity), Loyalty rules, Coupons.
6. **Online booking settings**: enable it and pick a slug (`settings/online-booking`).

## 4. Where customers come from

```
               ┌─────────── Public booking page (/book/:slug) ───────────┐
               │ config → branches → services/staff → available slots    │
               │ POST /public-booking/:slug/...                         │
               │ finds or creates Customer by phone                      │
               └──► Appointment (source=PUBLIC, status=SCHEDULED) ───────┤
                                                                         │
Front desk: Appointments.jsx (calendar) ──► Appointment (INTERNAL)  ─────┤
                                                                         │
Front desk: Job cart create (walk-in) ──► Appointment (WALK_IN) ─────────┤
                                          + DRAFT Invoice                ▼
                                                              Billing (section 6)
```
Customers are always matched by phone. A new phone number creates a new customer.

## 5. Appointment lifecycle

```
SCHEDULED ─► CONFIRMED ─► CHECKED_IN ─► COMPLETED
    │             │             │            │
    └─────────────┴─────────────┴──► CANCELLED / NO_SHOW
                                             ▲
                     COMPLETED ──────────────┘ (cancel after completion reverses side effects)
```
- `PATCH /appointments/:id/status` writes `AppointmentStatusHistory` + an `AuditLog` for every change.
- **→ COMPLETED**: deducts each service's **consumables** from stock (`USED_IN_SERVICE` movement).
- **COMPLETED → CANCELLED**: puts the consumables back and reverses any package usage.
- Reschedule checks staff availability and conflicts. Completed, cancelled and no-show appointments can't be edited.

## 6. Billing: the job cart (main POS flow)

The job cart is the main counter flow. A job cart is an `Appointment` (source `WALK_IN`) with a `DRAFT` invoice attached.

```
JobCartCreate.jsx
  POST /job-carts                  customer (by phone), branch, services, staff, price overrides
    → Appointment SCHEDULED/WALK_IN
    → Invoice DRAFT/UNPAID (GST_INVOICE if salon.gstEnabled else BILL_OF_SUPPLY)

JobCartDetails.jsx (edit while the cart is still open)
  POST/PATCH/DELETE /job-carts/:id/items          services, products, packages, memberships
  POST/DELETE /job-carts/:id/package-redemptions  redeem from a customer package (RESERVED)
  POST /invoices/:id/apply-coupon | remove-coupon | redeem-loyalty

  POST /job-carts/:id/confirm   { discount, invoiceType, taxPercent, payments[], status }
```

### What confirm does (one DB transaction; everything rolls back if any step fails)

1. Locks the cart and checks it has at least one line and no staff time conflicts.
2. Package redemptions go from **RESERVED to USED**.
3. **Discounts**:
   - manual discount (capped at the subtotal)
   - + membership discount = `discount %` of the *membership-discountable* lines. That means services, plus packages only if `membershipDiscountOnPackages` is on. Products are never discounted.
   - If `stackMembershipDiscount` is off, a membership discount can't be combined with a manual discount or a price override (`assertNoStackedDiscount`).
4. **GST** per line (`calculateInvoiceGst`), round-off, processing fee. The resulting totals are written to the invoice.
5. Appointment → **COMPLETED**.
6. If `status !== DRAFT`: the invoice is **ISSUED**, then each tender in `payments[]` is settled in turn (split payment, see section 7).
   A draft invoice cannot take a payment.
7. **Products** on the bill leave stock (`RETAIL_SALE` movement). A shortfall fails the whole confirm.
8. **Packages** sold on the bill → `CustomerPackage` created with service balances and a `validUntil` date.
9. **Memberships** sold on the bill → `CustomerMembership` is assigned and its wallet credited (`PURCHASE_CREDIT`).
   This happens *last*, so the new wallet can't pay for the bill that bought it and the discount applied is the one the customer walked in with.
10. Audit log `JOB_CART / COMPLETE`.

### Cancel

`POST /job-carts/:id/cancel` is refused if any payment has been taken. Otherwise it reverses consumables and package usage, then sets the appointment and invoice to **CANCELLED**.

### Other billing entry points
- `POST /invoices/from-appointment/:appointmentId` bills a completed booked appointment (`AppointmentBill.jsx`).
- `PATCH /invoices/:id/issue` issues a parked draft.
- `PATCH /invoices/:id/cancel` works only if nothing has been paid.
- `Billing.jsx` lists invoices. `InvoiceDetails.jsx`, `InvoicePrint.jsx` and `billing/invoices/:id/pay` take a later payment.

## 7. Payment settlement (`settleInvoiceInTransaction`)

Every payment goes through this function: job-cart confirm, `POST /payments`, and `POST /membership-wallets/pay`.

```
invoice ISSUED? not CANCELLED? balance > 0? appointment not cancelled?
  ├─ amount ≤ balance
  ├─ method = MEMBERSHIP_WALLET:
  │     amount ≤ walletPayableFor(invoice)   ← services only (never products/packages/memberships)
  │     funds proven first, then SPEND rows drawn across the customer's wallets
  ├─ Payment row, invoice paidAmount/balanceAmount updated
  ├─ paymentStatus: UNPAID → PARTIALLY_PAID → PAID
  ├─ CustomerTransaction (PAYMENT) → customer outstanding updated
  └─ fully paid → loyalty points awarded
```
Payment methods: CASH, UPI, GPAY, PAYTM, PHONEPE, CARD, BANK_TRANSFER, CHEQUE, MEMBERSHIP_WALLET, OTHER. The app only records payments; no payment gateway is wired in.

## 8. Customer retention

| Feature | Lifecycle |
|---|---|
| **Membership** | Sold on a job cart → `CustomerMembership` ACTIVE → EXPIRED (by `durationMonths`) / CANCELLED / REMOVED. It gives a discount % on services. |
| **Membership wallet** | Credited when the membership is sold (`walletCreditAmount` can be more than the price). Admins can top up or adjust it. It is spent on **services only**. Refunded on reversal and forfeited when the membership ends. Ledger: `MembershipWalletTransaction`. |
| **Package** | Sold on a job cart → `CustomerPackage` ACTIVE with per-service balances. Redeeming on a cart moves a balance from reserved to used on confirm. Ends as USED or EXPIRED. |
| **Loyalty** | Points are awarded when an invoice is fully paid (per `LoyaltyRule`) and redeemed against an invoice. |
| **Coupons** | Applied to or removed from an invoice before it is issued. |

## 9. Retail sales (products only, outside a job cart)

`RetailProducts.jsx` → `POST /retail-sales` records items, discount, tax and payment method, and writes a `RETAIL_SALE` stock movement per product.

## 10. Inventory

```
Vendor ──► Product purchase (POST /product-purchases) ──► STOCK_IN
                                                           │
 Job cart products / retail sales ─► RETAIL_SALE ──────────┤
 Completed appointment consumables ─► USED_IN_SERVICE ─────┼─► Product stock
 Manual: DAMAGED / ADJUSTMENT / RETURNED / STOCK_OUT ──────┘
                                                           │
                         after every movement (syncStockLifecycleAfterMovement):
                         below reorder level → StockAlert OPEN + ReorderSuggestion PENDING
                         back above → StockAlert RESOLVED
ReorderSuggestion: PENDING → APPROVED / REJECTED → CONVERTED_TO_PURCHASE
Vendor payments settle what is owed on purchases.
```
UI: `admin/inventory/:tab` (receive, low-stock, reorder, activity), `admin/vendors`.

## 11. Staff operations

```
Attendance (check-in, late minutes) ─┐
Leaves: PENDING → APPROVED/REJECTED/CANCELLED ─┼─► Salary slip generate (per month)
Service + retail sales (commission) ─┘         DRAFT/GENERATED → PAID | CANCELLED  (+ PDF)
```
Salary is calculated from `StaffSalaryConfig`: salary type, late penalty, paid vs unpaid leave days, and commission.

## 12. Expenses

Expense categories (`ExpenseCategoryDefinition`) → expenses per branch, optionally linked to a vendor. The `requireApproval` flag exists but nothing enforces it yet.

## 13. Reports and oversight

- **Reports**: sales, EOD, salon report, staff performance, inventory, products, expenses. Most export to Excel or PDF.
- **Audit trail**: every create, update, status change, complete and cancel writes an `AuditLog` (`reports/audit-trails`).
- **Support tickets**: in-app (`support`) and public (`support/public`).
- **AI assistant**: `/ai-assistant`, a Gemini-backed Q&A over salon data.

---

## Typical day at the counter

```
Customer walks in / arrives for booking
  → open job cart (or bill the appointment)
  → add services (+ products / package / membership), redeem package if any
  → apply coupon / loyalty
  → confirm: discounts + GST → invoice ISSUED → take payment(s), split allowed
  → stock, packages, memberships, loyalty all updated in the same transaction
  → print invoice
End of day → EOD report
```
