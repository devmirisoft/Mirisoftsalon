import { downloadFile, request, requestBlob } from "./api";

export const salonApi = {
  auth: {
    me: () => request("/api/auth/me"),
  },
  profile: {
    get: () => request("/api/profile"),
    update: (body) => request("/api/profile", { method: "PUT", body }),
    salon: () => request("/api/salon-profile"),
    updateSalon: (body) =>
      request("/api/salon-profile", { method: "PUT", body }),
    branch: () => request("/api/branch-profile"),
    updateBranch: (body) =>
      request("/api/branch-profile", { method: "PUT", body }),
    gst: () => request("/api/salon-profile/gst"),
    updateGst: (body) =>
      request("/api/salon-profile/gst", { method: "PUT", body }),
  },
  users: {
    list: () => request("/api/users"),
    createSalonAdmin: (body) =>
      request("/api/users/salon-admin", { method: "POST", body }),
    createReceptionist: (body) =>
      request("/api/users/receptionist", { method: "POST", body }),
  },
  salons: {
    list: () => request("/api/salons"),
    create: (body) => request("/api/salons", { method: "POST", body }),
    gstSettings: (salonId) =>
      request(
        salonId
          ? `/api/salons/${salonId}/gst/settings`
          : "/api/salons/gst/settings"
      ),
    updateGstSettings: (body, salonId) =>
      request(
        salonId
          ? `/api/salons/${salonId}/gst/settings`
          : "/api/salons/gst/settings",
        { method: "PATCH", body }
      ),
  },
  branches: {
    list: () => request("/api/branches"),
    get: (id) => request(`/api/branches/${id}`),
    create: (body) => request("/api/branches", { method: "POST", body }),
    update: (id, body) =>
      request(`/api/branches/${id}`, { method: "PUT", body }),
    remove: (id) => request(`/api/branches/${id}`, { method: "DELETE" }),
  },
  staff: {
    list: () => request("/api/staff"),
    get: (id) => request(`/api/staff/${id}`),
    create: (body) => request("/api/staff", { method: "POST", body }),
    update: (id, body) =>
      request(`/api/staff/${id}`, { method: "PUT", body }),
    setStatus: (id, status) =>
      request(`/api/staff/${id}/status`, {
        method: "PATCH",
        body: { status },
      }),
    remove: (id) => request(`/api/staff/${id}`, { method: "DELETE" }),
  },
  staffAvailability: {
    list: (query) => request("/api/staff-availability", { query }),
    get: (id) => request(`/api/staff-availability/${id}`),
    create: (body) =>
      request("/api/staff-availability", { method: "POST", body }),
    update: (id, body) =>
      request(`/api/staff-availability/${id}`, { method: "PUT", body }),
    setStatus: (id, status) =>
      request(`/api/staff-availability/${id}/status`, {
        method: "PATCH",
        body: { status },
      }),
    remove: (id) =>
      request(`/api/staff-availability/${id}`, { method: "DELETE" }),
    slots: (query) => request("/api/staff-availability/slots", { query }),
  },
  staffTimeBlocks: {
    list: (query) => request("/api/staff-time-blocks", { query }),
    get: (id) => request(`/api/staff-time-blocks/${id}`),
    create: (body) =>
      request("/api/staff-time-blocks", { method: "POST", body }),
    update: (id, body) =>
      request(`/api/staff-time-blocks/${id}`, { method: "PUT", body }),
    remove: (id) =>
      request(`/api/staff-time-blocks/${id}`, { method: "DELETE" }),
  },
  staffRoster: {
    get: (query) => request("/api/staff-roster", { query }),
  },
  customers: {
    list: () => request("/api/customers"),
    get: (id) => request(`/api/customers/${id}`),
    create: (body) => request("/api/customers", { method: "POST", body }),
    update: (id, body) =>
      request(`/api/customers/${id}`, { method: "PUT", body }),
    remove: (id) => request(`/api/customers/${id}`, { method: "DELETE" }),
    transactions: (id) => request(`/api/customers/${id}/transactions`),
    addWallet: (id, body) =>
      request(`/api/customers/${id}/wallet/add`, { method: "POST", body }),
    setMembership: (id, membershipId) =>
      request(`/api/customers/${id}/membership`, { method: "PATCH", body: { membershipId } }),
    memberships: (id) => request(`/api/customers/${id}/memberships`),
    assignMembership: (id, body) =>
      request(`/api/customers/${id}/memberships`, { method: "POST", body }),
  },
  memberships: {
    list: (query) => request("/api/memberships", { query }),
    get: (id) => request(`/api/memberships/${id}`),
    create: (body) => request("/api/memberships", { method: "POST", body }),
    update: (id, body) => request(`/api/memberships/${id}`, { method: "PUT", body }),
    setStatus: (id, status) => request(`/api/memberships/${id}/status`, { method: "PATCH", body: { status } }),
    remove: (id) => request(`/api/memberships/${id}`, { method: "DELETE" }),
  },
  customerMemberships: {
    list: (query) => request("/api/customer-memberships", { query }),
    get: (id) => request(`/api/customer-memberships/${id}`),
    cancel: (id) =>
      request(`/api/customer-memberships/${id}/cancel`, { method: "PATCH" }),
    remove: (id) =>
      request(`/api/customer-memberships/${id}/remove`, { method: "PATCH" }),
    expire: (id) =>
      request(`/api/customer-memberships/${id}/expire`, { method: "PATCH" }),
  },
  packageCategories: {
    list: (query) => request("/api/package-categories", { query }),
    get: (id) => request(`/api/package-categories/${id}`),
    create: (body) =>
      request("/api/package-categories", { method: "POST", body }),
    update: (id, body) =>
      request(`/api/package-categories/${id}`, { method: "PUT", body }),
    setStatus: (id, status) =>
      request(`/api/package-categories/${id}/status`, {
        method: "PATCH",
        body: { status },
      }),
    remove: (id) =>
      request(`/api/package-categories/${id}`, { method: "DELETE" }),
  },
  packages: {
    list: (query) => request("/api/packages", { query }),
    customerCustom: (query) =>
      request("/api/packages/customer-custom", { query }),
    get: (id) => request(`/api/packages/${id}`),
    create: (body) => request("/api/packages", { method: "POST", body }),
    createCustomFromCart: (body) =>
      request("/api/packages/custom/from-cart", { method: "POST", body }),
    copyCustom: (body) =>
      request("/api/packages/custom/copy", { method: "POST", body }),
    update: (id, body) =>
      request(`/api/packages/${id}`, { method: "PUT", body }),
    setStatus: (id, status) =>
      request(`/api/packages/${id}/status`, {
        method: "PATCH",
        body: { status },
      }),
    remove: (id) => request(`/api/packages/${id}`, { method: "DELETE" }),
  },
  customerPackages: {
    list: (query) => request("/api/customer-packages", { query }),
    forCustomer: (customerId, query) =>
      request(`/api/customers/${customerId}/packages`, { query }),
    get: (id) => request(`/api/customer-packages/${id}`),
    balances: (id) => request(`/api/customer-packages/${id}/balances`),
    usages: (id) => request(`/api/customer-packages/${id}/usages`),
    balancesForCustomer: (customerId) =>
      request(`/api/customers/${customerId}/package-balances`),
    setStatus: (id, status) =>
      request(`/api/customer-packages/${id}/status`, {
        method: "PATCH",
        body: { status },
      }),
  },
  loyaltyRules: {
    list: (query) => request("/api/loyalty-rules", { query }),
    active: (query) => request("/api/loyalty-rules/active", { query }),
    get: (id) => request(`/api/loyalty-rules/${id}`),
    create: (body) => request("/api/loyalty-rules", { method: "POST", body }),
    update: (id, body) => request(`/api/loyalty-rules/${id}`, { method: "PUT", body }),
    setStatus: (id, status) => request(`/api/loyalty-rules/${id}/status`, { method: "PATCH", body: { status } }),
  },
  loyalty: {
    history: (customerId) => request(`/api/loyalty/customers/${customerId}/transactions`),
    transactions: (query) => request("/api/loyalty-transactions", { query }),
    adjust: (customerId, body) => request(`/api/loyalty/customers/${customerId}/adjust`, { method: "POST", body }),
  },
  coupons: {
    list: (query) => request("/api/coupons", { query }),
    get: (id) => request(`/api/coupons/${id}`),
    create: (body) => request("/api/coupons", { method: "POST", body }),
    update: (id, body) => request(`/api/coupons/${id}`, { method: "PUT", body }),
    setStatus: (id, isActive) =>
      request(`/api/coupons/${id}/status`, {
        method: "PATCH",
        body: { isActive },
      }),
    remove: (id) => request(`/api/coupons/${id}`, { method: "DELETE" }),
  },
  mainServices: {
    list: () => request("/api/main-services"),
    get: (id) => request(`/api/main-services/${id}`),
    create: (body) => request("/api/main-services", { method: "POST", body }),
    update: (id, body) =>
      request(`/api/main-services/${id}`, { method: "PUT", body }),
    setStatus: (id, status) =>
      request(`/api/main-services/${id}/status`, {
        method: "PATCH",
        body: { status },
      }),
    remove: (id) => request(`/api/main-services/${id}`, { method: "DELETE" }),
  },
  services: {
    list: () => request("/api/services"),
    seedDefaults: (body = {}) =>
      request("/api/services/seed-defaults", { method: "POST", body }),
    get: (id) => request(`/api/services/${id}`),
    create: (body) => request("/api/services", { method: "POST", body }),
    update: (id, body) =>
      request(`/api/services/${id}`, { method: "PUT", body }),
    setStatus: (id, status) =>
      request(`/api/services/${id}/status`, {
        method: "PATCH",
        body: { status },
      }),
    remove: (id) => request(`/api/services/${id}`, { method: "DELETE" }),
  },
  serviceConsumables: {
    list: (serviceId) => request(`/api/services/${serviceId}/consumables`),
    create: (serviceId, body) =>
      request(`/api/services/${serviceId}/consumables`, {
        method: "POST",
        body,
      }),
    update: (id, body) =>
      request(`/api/service-consumables/${id}`, { method: "PUT", body }),
    remove: (id) =>
      request(`/api/service-consumables/${id}`, { method: "DELETE" }),
  },
  appointments: {
    list: (query) => request("/api/appointments", { query }),
    get: (id) => request(`/api/appointments/${id}`),
    create: (body) => request("/api/appointments", { method: "POST", body }),
    update: (id, body) =>
      request(`/api/appointments/${id}`, { method: "PUT", body }),
    setStatus: (id, body) =>
      request(`/api/appointments/${id}/status`, { method: "PATCH", body }),
    reschedule: (id, startTime) =>
      request(`/api/appointments/${id}/reschedule`, {
        method: "PATCH",
        body: { startTime },
      }),
    tracking: (id) => request(`/api/appointments/${id}/tracking`),
    remove: (id) => request(`/api/appointments/${id}`, { method: "DELETE" }),
  },
  jobCarts: {
    list: (query) => request("/api/job-carts", { query }),
    references: (query) =>
      request("/api/job-carts/references", { query }),
    customerSummary: (query) =>
      request("/api/job-carts/customer-summary", { query }),
    get: (id) => request(`/api/job-carts/${id}`),
    create: (body) =>
      request("/api/job-carts", { method: "POST", body }),
    update: (id, body) =>
      request(`/api/job-carts/${id}`, { method: "PUT", body }),
    addItem: (id, item) =>
      request(`/api/job-carts/${id}/items`, {
        method: "POST",
        body:
          typeof item === "string"
            ? { itemType: "SERVICE", serviceId: item }
            : item,
      }),
    removeItem: (id, itemId) =>
      request(`/api/job-carts/${id}/items/${itemId}`, {
        method: "DELETE",
      }),
    redemptions: (id) =>
      request(`/api/job-carts/${id}/package-redemptions`),
    addRedemption: (id, body) =>
      request(`/api/job-carts/${id}/package-redemptions`, {
        method: "POST",
        body,
      }),
    removeRedemption: (id, usageId) =>
      request(`/api/job-carts/${id}/package-redemptions/${usageId}`, {
        method: "DELETE",
      }),
    confirm: (id) =>
      request(`/api/job-carts/${id}/confirm`, { method: "POST" }),
    cancel: (id) =>
      request(`/api/job-carts/${id}/cancel`, { method: "POST" }),
  },
  publicBooking: {
    config: (slug) => request(`/api/public-booking/${slug}/config`),
    branches: (slug) => request(`/api/public-booking/${slug}/branches`),
    services: (slug, branchId) =>
      request(`/api/public-booking/${slug}/services`, { query: { branchId } }),
    slots: (slug, query) =>
      request(`/api/public-booking/${slug}/available-slots`, { query }),
    book: (slug, body) =>
      request(`/api/public-booking/${slug}/appointments`, {
        method: "POST",
        body,
      }),
  },
  publicBookingSettings: {
    list: (query) => request("/api/public-booking-settings", { query }),
    get: (id) => request(`/api/public-booking-settings/${id}`),
    create: (body) =>
      request("/api/public-booking-settings", { method: "POST", body }),
    update: (id, body) =>
      request(`/api/public-booking-settings/${id}`, { method: "PUT", body }),
    setStatus: (id, isEnabled) =>
      request(`/api/public-booking-settings/${id}/status`, {
        method: "PATCH",
        body: { isEnabled },
      }),
  },
  invoices: {
    list: (query) => request("/api/invoices", { query }),
    get: (id) => request(`/api/invoices/${id}`),
    fromAppointment: (appointmentId, body) =>
      request(`/api/invoices/from-appointment/${appointmentId}`, {
        method: "POST",
        body,
      }),
    cancel: (id) =>
      request(`/api/invoices/${id}/cancel`, { method: "PATCH" }),
    redeemLoyalty: (id, points) =>
      request(`/api/invoices/${id}/redeem-loyalty`, { method: "POST", body: { points } }),
    applyCoupon: (id, couponCode) =>
      request(`/api/invoices/${id}/apply-coupon`, {
        method: "POST",
        body: { couponCode },
      }),
    removeCoupon: (id) =>
      request(`/api/invoices/${id}/remove-coupon`, { method: "POST" }),
    issue: (id) =>
      request(`/api/invoices/${id}/issue`, { method: "PATCH" }),
  },
  payments: {
    list: (query) => request("/api/payments", { query }),
    get: (id) => request(`/api/payments/${id}`),
    create: (body) => request("/api/payments", { method: "POST", body }),
  },
  productBrands: {
    list: () => request("/api/product-brands"),
    get: (id) => request(`/api/product-brands/${id}`),
    create: (body) => request("/api/product-brands", { method: "POST", body }),
    update: (id, body) => request(`/api/product-brands/${id}`, { method: "PUT", body }),
    setStatus: (id, status) => request(`/api/product-brands/${id}/status`, { method: "PATCH", body: { status } }),
    remove: (id) => request(`/api/product-brands/${id}`, { method: "DELETE" }),
  },
  products: {
    list: (query) => request("/api/products", { query }),
    lowStock: () => request("/api/products/low-stock"),
    get: (id) => request(`/api/products/${id}`),
    create: (body) => request("/api/products", { method: "POST", body }),
    update: (id, body) => request(`/api/products/${id}`, { method: "PUT", body }),
    setStatus: (id, status) => request(`/api/products/${id}/status`, { method: "PATCH", body: { status } }),
    remove: (id) => request(`/api/products/${id}`, { method: "DELETE" }),
  },
  productPurchases: {
    list: (query) => request("/api/product-purchases", { query }),
    get: (id) => request(`/api/product-purchases/${id}`),
    create: (body) => request("/api/product-purchases", { method: "POST", body }),
  },
  retailSales: {
    list: () => request("/api/retail-sales"),
    get: (id) => request(`/api/retail-sales/${id}`),
    create: (body) => request("/api/retail-sales", { method: "POST", body }),
  },
  attendance: {
    list: (query) => request("/api/attendance", { query }),
    checkIn: (body) => request("/api/attendance/check-in", { method: "POST", body }),
    checkOut: (body) => request("/api/attendance/check-out", { method: "POST", body }),
    mark: (body) => request("/api/attendance/mark", { method: "POST", body }),
  },
  leaves: {
    list: (query) => request("/api/leaves", { query }),
    create: (body) => request("/api/leaves", { method: "POST", body }),
    approve: (id) => request(`/api/leaves/${id}/approve`, { method: "PATCH" }),
    reject: (id, rejectionReason) => request(`/api/leaves/${id}/reject`, { method: "PATCH", body: { rejectionReason } }),
    cancel: (id) => request(`/api/leaves/${id}/cancel`, { method: "PATCH" }),
  },
  salaryConfigs: {
    active: (staffId) => request(`/api/staff/${staffId}/salary-config`),
    create: (staffId, body) => request(`/api/staff/${staffId}/salary-config`, { method: "POST", body }),
    update: (id, body) => request(`/api/salary-configs/${id}`, { method: "PUT", body }),
    setStatus: (id, status) => request(`/api/salary-configs/${id}/status`, { method: "PATCH", body: { status } }),
  },
  salarySlips: {
    list: (query) => request("/api/salary-slips", { query }),
    get: (id) => request(`/api/salary-slips/${id}`),
    generate: (body) => request("/api/salary-slips/generate", { method: "POST", body }),
    markPaid: (id) => request(`/api/salary-slips/${id}/mark-paid`, { method: "PATCH" }),
    cancel: (id) => request(`/api/salary-slips/${id}/cancel`, { method: "PATCH" }),
    pdf: (id) => requestBlob(`/api/salary-slips/${id}/pdf`),
  },
  stockMovements: {
    list: (query) => request("/api/stock-movements", { query }),
    byProduct: (productId) => request(`/api/stock-movements/product/${productId}`),
    createManual: (body) => request("/api/stock-movements/manual", { method: "POST", body }),
  },
  stockAlerts: {
    list: (query) => request("/api/stock-alerts", { query }),
    get: (id) => request(`/api/stock-alerts/${id}`),
    resolve: (id) =>
      request(`/api/stock-alerts/${id}/resolve`, { method: "PATCH" }),
  },
  reorderSuggestions: {
    list: (query) => request("/api/reorder-suggestions", { query }),
    get: (id) => request(`/api/reorder-suggestions/${id}`),
    approve: (id) =>
      request(`/api/reorder-suggestions/${id}/approve`, { method: "PATCH" }),
    reject: (id) =>
      request(`/api/reorder-suggestions/${id}/reject`, { method: "PATCH" }),
    convert: (id) =>
      request(`/api/reorder-suggestions/${id}/convert-to-purchase`, {
        method: "POST",
      }),
  },
  auditLogs: {
    list: (query) => request("/api/audit-logs", { query }),
    get: (id) => request(`/api/audit-logs/${id}`),
  },
  vendors: {
    list: (query) => request("/api/vendors", { query }),
    get: (id) => request(`/api/vendors/${id}`),
    create: (body) => request("/api/vendors", { method: "POST", body }),
    update: (id, body) => request(`/api/vendors/${id}`, { method: "PUT", body }),
    setStatus: (id, status) => request(`/api/vendors/${id}/status`, { method: "PATCH", body: { status } }),
    remove: (id) => request(`/api/vendors/${id}`, { method: "DELETE" }),
  },
  vendorPayments: {
    list: (query) => request("/api/vendor-payments", { query }),
    get: (id) => request(`/api/vendor-payments/${id}`),
    create: (body) => request("/api/vendor-payments", { method: "POST", body }),
  },
  expenses: {
    list: (query) => request("/api/expenses", { query }),
    get: (id) => request(`/api/expenses/${id}`),
    create: (body) => request("/api/expenses", { method: "POST", body }),
    update: (id, body) => request(`/api/expenses/${id}`, { method: "PUT", body }),
    remove: (id) => request(`/api/expenses/${id}`, { method: "DELETE" }),
  },
  expenseCategories: {
    list: (query) => request("/api/expense-categories", { query }),
    get: (id) => request(`/api/expense-categories/${id}`),
    create: (body) => request("/api/expense-categories", { method: "POST", body }),
    update: (id, body) => request(`/api/expense-categories/${id}`, { method: "PUT", body }),
    setStatus: (id, status) => request(`/api/expense-categories/${id}/status`, { method: "PATCH", body: { status } }),
    remove: (id) => request(`/api/expense-categories/${id}`, { method: "DELETE" }),
  },
  reports: {
    inventory: (query) => request("/api/reports/inventory", { query }),
    expenses: (query) => request("/api/reports/expenses", { query }),
    profitSummary: (query) => request("/api/reports/profit-summary", { query }),
    staffPerformance: (query) => request("/api/reports/staff-performance", { query }),
    exportFile: (reportType, format, query = {}) =>
      downloadFile(`/api/reports/${reportType}/export`, {
        ...query,
        format,
      }),
  },
  support: {
    createPublic: (body) =>
      request("/api/support-tickets/public", { method: "POST", body }),
    getPublic: (ticketCode, email) =>
      request(`/api/support-tickets/public/${ticketCode}`, {
        query: { email },
      }),
    create: (body) =>
      request("/api/support-tickets", { method: "POST", body }),
    list: (query) => request("/api/support-tickets", { query }),
    mine: () => request("/api/support-tickets/my"),
    get: (id) => request(`/api/support-tickets/${id}`),
    setStatus: (id, body) =>
      request(`/api/support-tickets/${id}/status`, {
        method: "PATCH",
        body,
      }),
    assign: (id, assignedToId) =>
      request(`/api/support-tickets/${id}/assign`, {
        method: "PATCH",
        body: { assignedToId },
      }),
    addMessage: (id, body) =>
      request(`/api/support-tickets/${id}/messages`, {
        method: "POST",
        body,
      }),
  },
};
