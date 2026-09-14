# SRS Implementation Status

Source: `Jatin salon.docx`. Tracked against the codebase as of 2026-09-12 (branch `new`).

Legend: ✅ done · 🟡 partial · ❌ not started

---

## 1. Finalised Feature List (doc section "Lets Finalize the feature list")

| # | Feature | Doc priority | Status | Where it lives / what is missing |
|---|---|---|---|---|
| 1 | User Authentication & Authorization | High | 🟡 | `features/auth` (register/login/refresh/logout/me), JWT + bcryptjs, `Role` enum (SUPER_ADMIN, SALON_ADMIN, BRANCH_MANAGER, RECEPTIONIST, STAFF), `UserSession`, login rate limiter. **Missing: forgot-password / reset-password endpoints** — `pages/auth/ForgotPassword.jsx` exists on the frontend with no backend route behind it. |
| 2 | Appointment & Service Management | High | ✅ | `features/appointments`, `services`, `main-services`; `AppointmentStatusHistory`, `AppointmentService`. FullCalendar UI in `components/salon/AppointmentCalendar.jsx` and `pages/salon/Appointments.jsx`. |
| 3 | Billing & Payment Management | High | ✅ | `features/Invoices`, `Payments`, `job-carts`; `Sale`/`SaleItem`/`SalePayment`, `Invoice`/`InvoiceItem`. GST config on `Salon` (separate service + product rates), discount, round-off, part payments, 10 payment methods incl. membership wallet. UI: `Billing.jsx`, `JobCart*.jsx`, `InvoiceDetails.jsx`, `InvoicePrint.jsx`. |
| 4 | Staff & Customer Management | High | ✅ | `features/staff`, `features/customers`; `Staff`, `StaffAttendance`, `StaffLeave`, `StaffAvailabilityRule`, `StaffTimeBlock`, `CustomerTransaction`. UI: `Customers.jsx`, `StaffPerformance.jsx`, `ShiftRoster.jsx`. |
| 5 | Inventory & Expense Management | High | ✅ | `features/products`, `product-purchases`, `stock`, `stock-movements`, `stock-alerts`, `reorder-suggestions`, `expenses`, `expense-categories`, `vendors`, `vendor-payments`. UI: `Products`, `ProductPurchases`, `StockAlerts`, `LowStock`, `InventoryReport`, `Expenses`. |
| 6 | SMS & Email Integration | High | ❌ | No provider dependency installed (no twilio / msg91 / sendgrid / nodemailer). No `SMS_Logs` or `Email_Logs` models. Nothing sends anything. |
| 7 | Analytics & Reporting | Medium | ✅ | `features/reports` → `/reports/inventory`, `/staff-performance`, `/expenses`, `/salon-report`; export via `report-export.service.ts` (exceljs + pdfkit). UI: `Analytics.jsx`, `SalonReport.jsx`, `ExpenseReports.jsx`, `InventoryReport.jsx`. |
| 8 | Online Booking Widget & Customer Website Integration | Medium | 🟡 | `features/public-booking` + `public-booking-settings`, `PublicBookingSetting` model, `pages/public/PublicBooking.jsx`, `OnlineBookingSettings.jsx`. **Missing: embeddable widget / WordPress plugin** — it is a hosted page, not a drop-in snippet. |
| 9 | Notification & Reminders | Medium | ❌ | The doc's `Appointment_Reminders` table was never built; no scheduler (no node-cron or equivalent), no delivery channel. |
| 10 | Mobile App (customers & staff) | Medium | ❌ | Web only (React + Vite). No React Native / Flutter app. |
| 11 | Discount Coupon & Loyalty Program | Medium | ✅ | `features/coupons`, `loyalty`, `loyalty-rules`; `Coupon`, `LoyaltyRule`, `LoyaltyTransaction`. UI: `Coupons.jsx`, `LoyaltyRules.jsx`, `LoyaltyTransactions.jsx`. |
| 12 | Data Security & Backup | High | 🟡 | Security done: hashed passwords, JWT + cookies, CORS, rate limiting, zod validation, role guards. **Backup/restore not in-repo** — no documented or automated policy. |
| 13 | Social Media Integration & Email Marketing | Low | ❌ | Not started. |
| 14 | Customer Feedback & Ratings | Low | ❌ | No rating / feedback / review model anywhere in the schema. |
| 15 | Staff Salary & Leaves Management | Medium | ✅ | `StaffSalaryConfig` (`SalaryType`, `LatePenaltyType`), `SalarySlip`, `features/salary-slips` (+ PDF), `features/leaves`, `features/attendance`. UI: `SalarySlips.jsx`, `Leaves.jsx`, `Attendance.jsx`. |
| 16 | On-Demand Staffing | Low | ❌ | No contractual-employee pool. |
| 17 | Sales & Revenue Reports | Medium | ✅ | Covered by `/reports/salon-report` and `Analytics.jsx`. |
| 18 | Online Payment Gateway Integration | Medium | ❌ | No Razorpay / Instamojo / Stripe dependency. Payments are **recorded, not processed** — UPI/GPAY/PhonePe are manual entries. |
| 19 | Real-Time Availability | Medium | ✅ | `features/staff-availability`, `staff-time-blocks`, `staff-roster`; consumed by public booking. |
| 20 | Automated Reminders | Medium | ❌ | Same gap as #9. |
| 21 | Inventory Management | Medium | ✅ | See #5. |
| 22 | Mobile Wallet Integration | Medium | 🟡 | Recorded as payment methods (GPAY / PAYTM / PHONEPE / UPI). No actual wallet SDK or UPI intent flow. |
| 23 | Customer Profiles & Preferences | Low | 🟡 | `Customer` + `CustomerTransaction` + visit history (`JobCartCustomerHistory.jsx`). No stored preferences driving recommendations. |
| 24 | Data Backup & Recovery | High | ❌ | Nothing in-repo. |
| 25 | Automated Invoice Generation | Medium | 🟡 | Invoices generate from job carts / sales with PDF print. **Auto-delivery missing** — blocked on #6. |
| 26 | Customer Website Integration | High | 🟡 | Same as #8. |
| 27 | Staff Salary incl. Leaves & Other Payouts | High | ✅ | See #15; deductions, late penalty and commission handled in `features/staff/staff.salary.ts`. |
| 28 | Salon Expense Management | High | ✅ | `features/expenses` + `expense-categories`, branch- and vendor-linked. |
| 29 | Contractual Employee Management | Medium | ❌ | Not started. |
| 30 | Logging & Audit Trails | High | ✅ | `AuditLog` with `AuditModule` / `AuditAction` enums, `features/audit-logs`, `AuditTrails.jsx`. |
| 31 | Google Login Integration | Low | ❌ | Email/password only. |
| 32 | Transactional & Promotional Email | High | ❌ | See #6. |
| 33 | SMS API Integration | High | ❌ | See #6. |
| 34 | Staff Shift Scheduling | Medium | ✅ | `staff-roster` + `StaffAvailabilityRule` + `ShiftRoster.jsx`. |
| 35 | Staff Commission Calculation | Medium | ✅ | `features/staff/staff.salary.ts`; surfaced in salary slips and the staff-performance report. |
| 36 | Customer Membership Management | Low | ✅ | `Membership`, `CustomerMembership`, `MembershipWalletTransaction`; `features/memberships`, `customer-memberships`, `membership-wallets`. UI: `Memberships.jsx`, `ManageMemberships.jsx`. |
| 37 | Mobile App (duplicate of #10) | Medium | ❌ | — |
| 38 | Online Booking & Scheduling | High | ✅ | `features/public-booking`. |
| 39 | Automatic Inventory Restocking | Medium | 🟡 | `ReorderSuggestion` + `StockAlert` exist (suggest and alert). No automatic purchase-order placement. |
| 40 | Facial Recognition for Check-In | Low | ❌ | Not started. |
| 41 | Staff Training & Certification Tracking | Medium | ❌ | Not started. |
| 42 | Salon Maintenance & Cleaning Scheduling | Low | ❌ | Not started. |
| 43 | Customer Satisfaction Surveys | Low | ❌ | Not started. |
| 44 | Data Analytics & Business Insights | Medium | 🟡 | Reports exist, plus an AI assistant (`features/ai-assistant`, `@google/genai`) that is beyond the doc. No trend/forecast analytics. |
| 45 | Staff Incentive Programs | Low | 🟡 | Commission covers part of it; no separate incentive scheme. |
| 46 | Vendor Management | Low | ✅ | `Vendor`, `VendorPayment`, `features/vendors`, `vendor-payments`. UI: `Vendors.jsx`, `VendorPayments.jsx`. |
| 47 | Petty Cash Management | Low | 🟡 | Expressible as an expense category; no dedicated petty-cash ledger. |
| 48 | Currency Conversion | Low | ❌ | INR only. |
| 49 | Expense Reports | Medium | ✅ | `/reports/expenses` + `ExpenseReports.jsx`. |
| 50 | Budget Management | Medium | ❌ | No budget model or category limits. |
| 51 | Expense Approvals | Medium | 🟡 | `ExpenseCategoryDefinition.requireApproval` flag exists, but `Expense` has **no approval status, approver, or workflow** — the flag is currently inert. |
| 52 | Payment Method Preferences (staff payout) | Low | ❌ | Not on `Staff` or `StaffSalaryConfig`. |
| 53 | Salary Slip Generation | Medium | ✅ | `SalarySlip` + `salarySlip.pdf.ts` + `SalarySlips.jsx`. |

**Score: 20 ✅ · 12 🟡 · 21 ❌ (of 53)**

### Completion percentage

Counting a 🟡 as half:

| Basis | Completion |
|---|---|
| Raw feature count (53 items, unweighted) | **49%** |
| Weighted by doc priority (High×3, Medium×2, Low×1) | **54%** |
| Weighted by the doc's own week estimates (139.5 weeks total) | **50%** |
| — High-priority items only (15 items) | **63%** |
| — Medium-priority only (24 items) | **54%** |
| — Low-priority only (14 items) | **25%** |

**Headline: ~55% complete**, and the shape matters more than the number — the daily-operations core (billing, appointments, staff, inventory, customers, reports) is essentially finished. What remains is mostly outbound integrations (SMS, email, payment gateway), the SaaS/tenancy layer, a mobile app, and a tail of low-priority extras.

Caveat: the doc's list contains duplicates (mobile app listed twice, inventory twice, online booking three ways), which slightly inflates the ❌ column. Deduping moves the raw number by under a point.

---

## 2. Main Feature List (earlier doc section)

| Feature | Status | Note |
|---|---|---|
| Appointment scheduling + calendar view | ✅ | FullCalendar. |
| Appointment notifications for staff & customers | ❌ | No delivery channel. |
| Invoicing & billing, multiple payment methods | ✅ | Cash / card / digital all recorded. |
| Print or email invoice | 🟡 | Print ✅ (`InvoicePrint.jsx`, pdfkit). Email ❌. |
| Inventory tracking, low-stock alerts, product usage & cost | ✅ | Includes `ServiceConsumable` — per-service product consumption. |
| Customer database, service history, loyalty | ✅ | |
| Customer preferences & notes for recommendations | ❌ | |
| Staff schedules, roles/permissions, performance tracking | ✅ | |
| Reports on sales/revenue/popular services + export | ✅ | Excel and PDF export. |
| Online booking with real-time availability | ✅ | |
| POS integration | 🟡 | The job-cart flow is the POS; no external POS hardware/device integration. |
| Mobile app (Android/iOS) | ❌ | |
| Secure authentication + role-based access | ✅ | |
| Data backup & recovery | ❌ | |
| Multi-language support | ❌ | English only. |
| Multi-currency support | ❌ | INR only. |

---

## 3. Database Schema — doc vs. Prisma

The implementation goes well beyond the doc's final schema. Deltas:

**In the doc, missing from Prisma**

- `Tenants` table with `billing_plan` and `is_active` (Basic/Pro/Enterprise; active/suspended/trial/expired/gracePeriod) — **not built**. `Salon` is the tenant boundary, but there is **no subscription, plan, or SaaS-billing model**, which is the doc's whole rent-the-software premise.
- `Admins` table — folded into `User` + `Role.SUPER_ADMIN` instead (a reasonable simplification).
- `SMS_Logs`, `Email_Logs` — ❌
- `Appointment_Reminders` — ❌
- `Contractual_Employees` — ❌
- `Staff.payment_method_preference` — ❌
- Budget and expense-approval tables — ❌

**In Prisma, beyond the doc** (scope added since the doc was written)

- Multi-branch: `Branch` referenced by nearly every entity.
- Packages: `ServicePackage`, `ServicePackageItem`, `PackageCategory`, `CustomerPackage`, `CustomerPackageServiceBalance`, `CustomerPackageUsage`, `CustomerPackageUsageItem`.
- Memberships with a prepaid wallet: `CustomerMembership`, `MembershipWalletTransaction`.
- Retail: `RetailSale`, `RetailSaleItem`, `ProductBrand`, `ProductStockMovement`, `ProductPurchase`, `ProductPurchaseItem`.
- Sales layer under invoices (the job-cart model): `Sale`, `SaleItem`, `SalePayment`.
- Ops: `SupportTicket` (+ messages, status history), `SalonAssistantConversation`/`Message` (AI assistant), `UserSession`, `AuditLog`, `StaffTimeBlock`, `ExpenseCategoryDefinition`, `PublicBookingSetting`.
- GST is configured on `Salon` (service/product rates, GSTIN, legal name, state code) rather than the doc's `GST_Rates` table.

---

## 4. Stack — doc suggestion vs. actual

| Doc suggestion | Actual |
|---|---|
| Node.js backend | ✅ Express + TypeScript |
| PostgreSQL | ✅ Postgres via Prisma (`@prisma/adapter-pg`) |
| React frontend | ✅ React + Vite + Bootstrap/reactstrap |
| React Native / Flutter app | ❌ none |
| Razorpay / Instamojo | ❌ none |
| Twilio / MSG91 | ❌ none |
| SendGrid / Amazon SES | ❌ none |
| Google Maps API | 🟡 `@react-google-maps/api` installed |
| Passport.js / express-session / express-jwt | ❌ hand-rolled JWT + `UserSession` instead |
| WordPress REST API sync | ❌ |
| Git version control | ✅ |

---

## 5. Short list — highest-value gaps

1. **Notification channel (SMS + email)** — blocks reminders, invoice delivery, marketing, and password reset. Single biggest hole; four doc features depend on it.
2. **Forgot / reset password** — the UI page exists and goes nowhere.
3. **Payment gateway** — no online collection; every digital payment is a manual entry.
4. **Tenant / subscription model** — `billing_plan`, trial and expiry states are unbuilt.
5. **Expense approval workflow** — `requireApproval` is a dead flag today.
6. **Backup & recovery policy** — nothing documented or automated.
