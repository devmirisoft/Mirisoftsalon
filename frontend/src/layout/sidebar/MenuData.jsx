import { allowsRole } from "@/utils/salonFormat";

const hasRole = (role, roles) => allowsRole(roles, role);

const dashboardMenu = { icon: "dashboard-fill", text: "Dashboard", link: "/" };


// SUPER_ADMIN is a platform role: it has no salonId, so every salon-scoped page
// below either 400s or mixes tenants for it. It gets its own menu of the four
// things the backend actually lets it do (salons, user accounts, GST, support)
// plus the two reports that take an explicit salonId.
const superAdminMenu = [
  dashboardMenu,
  { heading: "Platform" },
  // /management already tabs Salons / Branches / Staff / GST / User accounts.
  { icon: "building", text: "Salon Management", link: "/management" },
  { heading: "Reports" },
  {
    icon: "reports",
    text: "Reports",
    subMenu: [
      { icon: "bar-chart-fill", text: "Sales Report", link: "/reports/sales" },
      { text: "Salon Report", link: "/reports/salon-report" },
      { text: "Audit Trails", link: "/reports/audit-trails" },
    ],
  },
];

const getMenu = (role) => {
  if (role === "SUPER_ADMIN") return superAdminMenu;

  const operationalRoles = [
    "SALON_ADMIN",
    "RECEPTIONIST",
    "STAFF",
  ];
  const inventoryRoles = [...operationalRoles, "BRANCH_MANAGER"];

  return [
  dashboardMenu,
  ...(hasRole(role, ["SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST", "STAFF"])
    ? [
        { heading: "Staff Operations" },
        {
          icon: "users-fill",
          text: "Staff Operations",
          subMenu: [
            { text: "Shift Roster", link: "/staff/shift-roster" },
            { text: "Attendance", link: "/staff-operations/attendance" },
            ...(role !== "RECEPTIONIST" ? [{ text: "Leaves", link: "/staff-operations/leaves" }] : []),
            ...(hasRole(role, ["SALON_ADMIN", "BRANCH_MANAGER", "STAFF"])
              ? [{ text: "Salary Slips", link: "/staff-operations/salary-slips" }]
              : []),
            ...(hasRole(role, ["SALON_ADMIN", "BRANCH_MANAGER"])
              ? [{ text: "Staff Performance", link: "/reports/staff-performance" }]
              : []),
          ],
        },
      ]
    : []),
  ...(hasRole(role, [...operationalRoles, "BRANCH_MANAGER"])
    ? [
        { heading: "Operations" },
        ...(hasRole(role, operationalRoles)
          ? [
              {
                icon: "calender-date-fill",
                text: "Appointments",
                link: "/appointments",
              },
            ]
          : []),
        ...(hasRole(role, [
          "SALON_ADMIN",
          "BRANCH_MANAGER",
          "RECEPTIONIST",
        ])
          ? [
              {
                icon: "cart-fill",
                text: "Job Cart",
                subMenu: [
                  { text: "Create Job Cart", link: "/job-carts/create" },
                  { text: "View Job Cart", link: "/job-carts" },
                ],
              },
              {
                icon: "package-fill",
                text: "Packages",
                subMenu: [
                  {
                    text: "Package Categories",
                    link: "/packages/categories",
                  },
                  { text: "Packages", link: "/packages" },
                ],
              },
            ]
          : []),
        ...(hasRole(role, operationalRoles)
          ? [
              {
                icon: "users-fill",
                text: "Customers",
                link: "/customers",
              },
              {
                icon: "file-text-fill",
                text: "Service Catalog",
                link: "/services",
              },
            ]
          : []),
      ]
    : []),
  ...(hasRole(role, ["SALON_ADMIN", "STAFF"])
    ? [
        {
          icon: "cc-alt-fill",
          text: "Billing & Payments",
          link: "/billing",
        },
      ]
    : []),
  ...(hasRole(role, inventoryRoles)
    ? [
        { heading: "Products & Inventory" },
        // Everything else (low stock, receive, activity, payments, history) is a tab inside these three.
        { icon: "package-fill", text: "Products", link: "/admin/products" },
        { icon: "layers-fill", text: "Inventory", link: "/admin/inventory" },
        { icon: "truck", text: "Vendors", link: "/admin/vendors" },
      ]
    : []),
  ...(hasRole(role, ["SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"])
    ? [
        { heading: "Customer Retention" },
        {
          icon: "heart-fill",
          text: "Customer Retention",
          subMenu: [
            { text: "Memberships", link: "/customer-retention/memberships" },
            { text: "Manage Memberships", link: "/customer-retention/manage-memberships" },
            { text: "Loyalty Rules", link: "/customer-retention/loyalty-rules" },
            { text: "Loyalty Transactions", link: "/customer-retention/loyalty-transactions" },
            { text: "Coupons", link: "/customer-retention/coupons" },
          ],
        },
        ...(hasRole(role, ["SALON_ADMIN"]) ? [
        { heading: "Expenses" },
        {
          icon: "pie-fill",
          text: "Expenses",
          subMenu: [
            { text: "Expense Categories", link: "/admin/expense-categories" },
            { text: "Expenses", link: "/admin/expenses" },
          ],
        },
        ] : []),
      ]
    : []),
  ...(hasRole(role, inventoryRoles)
    ? [
        { heading: "Reports" },
        {
          icon: "reports",
          text: "Reports",
          subMenu: [
            ...(hasRole(role, ["SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"])
              ? [{ icon: "bar-chart-fill", text: "Sales Report", link: "/reports/sales" }]
              : []),
            { text: "Inventory Report", link: "/reports/inventory" },
            { text: "Product Report", link: "/reports/products" },
            ...(hasRole(role, ["SALON_ADMIN", "BRANCH_MANAGER"])
              ? [{ text: "Audit Trails", link: "/reports/audit-trails" }]
              : []),
            ...(hasRole(role, ["SALON_ADMIN"])
              ? [{ text: "Salon Report", link: "/reports/salon-report" }]
              : []),
          ],
        },
      ]
    : []),
  ...(hasRole(role, ["SALON_ADMIN", "RECEPTIONIST"])
    ? [
        {
          heading: "Administration",
        },
        {
          icon: "setting-fill",
          text: "Salon Management",
          link: "/management",
        },
      ]
    : []),
  ...(hasRole(role, ["SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"])
    ? [
        {
          icon: "globe",
          text: "Online Booking",
          link: "/settings/online-booking",
        },
      ]
    : []),
  ];
};

export default getMenu;
