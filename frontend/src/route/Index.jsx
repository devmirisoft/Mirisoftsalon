import { useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";

import Homepage from "@/pages/Homepage";
import Appointments from "@/pages/salon/Appointments";
import Billing from "@/pages/salon/Billing";
import InvoiceDetails from "@/pages/salon/InvoiceDetails";
import InvoicePrint from "@/pages/salon/InvoicePrint";
import Customers from "@/pages/salon/Customers";
import Management from "@/pages/salon/Management";
import Profile from "@/pages/salon/Profile";
import ServiceCatalog from "@/pages/salon/ServiceCatalog";
import Support from "@/pages/salon/Support";
import ProductBrands from "@/pages/salon/ProductBrands";
import Products from "@/pages/salon/Products";
import ProductPurchases from "@/pages/salon/ProductPurchases";
import RetailProducts from "@/pages/salon/RetailProducts";
import StockMovements from "@/pages/salon/StockMovements";
import Vendors from "@/pages/salon/Vendors";
import VendorPayments from "@/pages/salon/VendorPayments";
import LowStock from "@/pages/salon/LowStock";
import StockAlerts from "@/pages/salon/StockAlerts";
import ReorderSuggestions from "@/pages/salon/ReorderSuggestions";
import AuditTrails from "@/pages/salon/AuditTrails";
import Memberships from "@/pages/salon/Memberships";
import LoyaltyRules from "@/pages/salon/LoyaltyRules";
import LoyaltyTransactions from "@/pages/salon/LoyaltyTransactions";
import Coupons from "@/pages/salon/Coupons";
import Expenses from "@/pages/salon/Expenses";
import ExpenseReports from "@/pages/salon/ExpenseReports";
import InventoryReport from "@/pages/salon/InventoryReport";
import ProfitSummary from "@/pages/salon/ProfitSummary";
import ExpenseCategories from "@/pages/salon/ExpenseCategories";
import Attendance from "@/pages/salon/Attendance";
import Leaves from "@/pages/salon/Leaves";
import SalaryConfig from "@/pages/salon/SalaryConfig";
import SalarySlips from "@/pages/salon/SalarySlips";
import StaffPerformance from "@/pages/salon/StaffPerformance";
import ShiftRoster from "@/pages/salon/ShiftRoster";
import OnlineBookingSettings from "@/pages/salon/OnlineBookingSettings";
import JobCarts from "@/pages/salon/JobCarts";
import JobCartCreate from "@/pages/salon/JobCartCreate";
import JobCartDetails from "@/pages/salon/JobCartDetails";
import JobCartCustomerHistory from "@/pages/salon/JobCartCustomerHistory";
import PackageCategories from "@/pages/salon/PackageCategories";
import ServicePackages from "@/pages/salon/ServicePackages";
import PublicBooking from "@/pages/public/PublicBooking";

import Login from "@/pages/auth/Login";
import Register from "@/pages/auth/Register";
import ForgotPassword from "@/pages/auth/ForgotPassword";
import Success from "@/pages/auth/Success";
import PublicSupport from "@/pages/auth/PublicSupport";

import Terms from "@/pages/others/Terms";
import Error404Modern from "@/pages/error/404-modern";

import Layout from "@/layout/Index";
import LayoutNoSidebar from "@/layout/Index-nosidebar";
import ThemeProvider from "@/layout/provider/Theme";
import {
  ProtectedRoute,
  PublicOnlyRoute,
  RoleRoute,
} from "@/auth/AuthRoutes";

const ScrollToTop = ({ children }) => {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);

  return children;
};

const Router = () => (
  <BrowserRouter
    future={{
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    }}
  >
    <ScrollToTop>
      <Routes>
        <Route element={<ThemeProvider />}>
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route index element={<Homepage />} />
              <Route
                element={
                  <RoleRoute
                    roles={[
                      "SUPER_ADMIN",
                      "SALON_ADMIN",
                      "BRANCH_MANAGER",
                      "RECEPTIONIST",
                      "STAFF",
                    ]}
                  />
                }
              >
                <Route path="profile" element={<Profile />} />
                <Route path="appointments" element={<Appointments />} />
                <Route path="customers" element={<Customers />} />
                <Route path="services" element={<ServiceCatalog />} />
                <Route path="support" element={<Support />} />
              </Route>

              <Route element={<RoleRoute roles={["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST", "STAFF"]} />}>
                <Route path="staff-operations/attendance" element={<Attendance />} />
                <Route path="staff-operations/leaves" element={<Leaves />} />
                <Route path="staff/shift-roster" element={<ShiftRoster />} />
              </Route>

              <Route
                element={
                  <RoleRoute
                    roles={[
                      "SUPER_ADMIN",
                      "SALON_ADMIN",
                      "BRANCH_MANAGER",
                      "RECEPTIONIST",
                    ]}
                  />
                }
              >
                <Route path="job-carts" element={<JobCarts />} />
                <Route path="job-carts/create" element={<JobCartCreate />} />
                <Route
                  path="job-carts/customers/:customerId"
                  element={<JobCartCustomerHistory />}
                />
                <Route path="job-carts/:id" element={<JobCartDetails />} />
                <Route
                  path="packages/categories"
                  element={<PackageCategories />}
                />
                <Route path="packages" element={<ServicePackages />} />
              </Route>

              <Route
                element={
                  <RoleRoute
                    roles={["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST", "STAFF"]}
                  />
                }
              >
                <Route path="admin/product-brands" element={<ProductBrands />} />
                <Route path="admin/products" element={<Products />} />
                <Route path="admin/vendors" element={<Vendors />} />
                <Route path="admin/stock-movements" element={<StockMovements />} />
                <Route path="admin/low-stock" element={<LowStock />} />
                <Route path="inventory/stock-alerts" element={<StockAlerts />} />
                <Route path="inventory/reorder-suggestions" element={<ReorderSuggestions />} />
                <Route path="reports/inventory" element={<InventoryReport />} />
              </Route>

              <Route
                element={
                  <RoleRoute roles={["SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST", "STAFF"]} />
                }
              >
                <Route path="billing" element={<Billing />} />
                <Route
                  path="billing/invoices/:invoiceId"
                  element={<InvoiceDetails />}
                />
                <Route
                  path="billing/invoices/:invoiceId/pay"
                  element={<InvoiceDetails />}
                />
              </Route>

              <Route
                element={
                  <RoleRoute
                    roles={["SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST"]}
                  />
                }
              >
                <Route path="management" element={<Management />} />
                <Route path="admin/retail-products" element={<RetailProducts />} />
              </Route>
              <Route element={<RoleRoute roles={["SUPER_ADMIN", "SALON_ADMIN"]} />}>
                <Route path="admin/product-purchases" element={<ProductPurchases />} />
                <Route path="admin/vendor-payments" element={<VendorPayments />} />
                <Route path="admin/expenses" element={<Expenses />} />
                <Route path="admin/expenses/add" element={<Expenses />} />
                <Route path="admin/expense-categories" element={<ExpenseCategories />} />
                <Route path="reports/expenses" element={<ExpenseReports />} />
                <Route path="reports/profit-summary" element={<ProfitSummary />} />
              </Route>
              <Route element={<RoleRoute roles={["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"]} />}>
                <Route path="customer-retention/memberships" element={<Memberships />} />
                <Route path="customer-retention/loyalty-rules" element={<LoyaltyRules />} />
                <Route path="staff-operations/salary-config" element={<SalaryConfig />} />
                <Route path="reports/staff-performance" element={<StaffPerformance />} />
                <Route path="reports/audit-trails" element={<AuditTrails />} />
                <Route path="customer-retention/loyalty-transactions" element={<LoyaltyTransactions />} />
                <Route path="customer-retention/coupons" element={<Coupons />} />
                <Route path="settings/online-booking" element={<OnlineBookingSettings />} />
              </Route>
              <Route element={<RoleRoute roles={["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "STAFF"]} />}>
                <Route path="staff-operations/salary-slips" element={<SalarySlips />} />
              </Route>
            </Route>

            <Route
              element={
                <RoleRoute roles={["SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST", "STAFF"]} />
              }
            >
              <Route element={<LayoutNoSidebar />}>
                <Route
                  path="billing/invoices/:invoiceId/print"
                  element={<InvoicePrint />}
                />
              </Route>
            </Route>
          </Route>

          <Route element={<PublicOnlyRoute />}>
            <Route element={<LayoutNoSidebar />}>
              <Route path="auth-success" element={<Success />} />
              <Route path="auth-reset" element={<ForgotPassword />} />
              <Route path="auth-register" element={<Register />} />
              <Route path="auth-login" element={<Login />} />
            </Route>
          </Route>

          <Route element={<LayoutNoSidebar />}>
            <Route path="book/:slug" element={<PublicBooking />} />
            <Route path="support/public" element={<PublicSupport />} />
            <Route path="pages/terms-policy" element={<Terms />} />
            <Route path="*" element={<Error404Modern />} />
          </Route>
        </Route>
      </Routes>
    </ScrollToTop>
  </BrowserRouter>
);

export default Router;
