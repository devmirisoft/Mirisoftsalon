const hasRole = (role, roles) => roles.includes(role);


const getMenu = (role) => {
  const operationalRoles = [
    "SUPER_ADMIN",
    "SALON_ADMIN",
    "RECEPTIONIST",
    "STAFF",
  ];
  const inventoryRoles = [...operationalRoles, "BRANCH_MANAGER"];

  return [
  {
    icon: "dashboard-fill",
    text: "Dashboard",
    link: "/",
  },
  ...(hasRole(role, ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST", "STAFF"])
    ? [
        {
          icon: "user",
          text: "Profile",
          link: "/profile",
        },
      ]
    : []),
  ...(hasRole(role, ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST", "STAFF"])
    ? [
        { heading: "Staff Operations" },
        {
          icon: "users-fill",
          text: "Staff Operations",
          subMenu: [
            { text: "Shift Roster", link: "/staff/shift-roster" },
            { text: "Attendance", link: "/staff-operations/attendance" },
            ...(role !== "RECEPTIONIST" ? [{ text: "Leaves", link: "/staff-operations/leaves" }] : []),
            ...(hasRole(role, ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "STAFF"])
              ? [{ text: "Salary Slips", link: "/staff-operations/salary-slips" }]
              : []),
            ...(hasRole(role, ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"])
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
          "SUPER_ADMIN",
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
                icon: "scissors",
                text: "Service Catalog",
                link: "/services",
              },
            ]
          : []),
      ]
    : []),
  ...(hasRole(role, ["SUPER_ADMIN", "SALON_ADMIN", "STAFF"])
    ? [
        {
          icon: "file-docs",
          text: "Billing & Payments",
          link: "/billing",
        },
      ]
    : []),
  ...(hasRole(role, inventoryRoles)
    ? [
        { heading: "Products" },
        {
          icon: "package-fill",
          text: "Product",
          subMenu: [
            { text: "Product Brand", link: "/admin/product-brands" },
            ...(hasRole(role, ["SUPER_ADMIN", "SALON_ADMIN"])
              ? [{ text: "Purchase Products", link: "/admin/product-purchases" }]
              : []),
            ...(hasRole(role, ["SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST"])
              ? [{ text: "Retail Products", link: "/admin/retail-products" }]
              : []),
          ],
        },
      ]
    : []),
  ...(hasRole(role, inventoryRoles)
    ? [
        { heading: "Vendors & Stock" },
        {
          icon: "package-fill",
          text: "Vendors & Stock",
          subMenu: [
            { text: "Products", link: "/admin/products" },
            { text: "Vendors", link: "/admin/vendors" },
            ...(hasRole(role, ["SUPER_ADMIN", "SALON_ADMIN"])
              ? [
                  {
                    text: "Vendor Payments",
                    link: "/admin/vendor-payments",
                  },
                ]
              : []),
            {
              text: "Stock Movements",
              link: "/admin/stock-movements",
            },
            { text: "Low Stock", link: "/admin/low-stock" },
            { text: "Stock Alerts", link: "/inventory/stock-alerts" },
            {
              text: "Reorder Suggestions",
              link: "/inventory/reorder-suggestions",
            },
          ],
        },
      ]
    : []),
  ...(hasRole(role, ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"])
    ? [
        { heading: "Customer Retention" },
        {
          icon: "growth-fill",
          text: "Customer Retention",
          subMenu: [
            { text: "Memberships", link: "/customer-retention/memberships" },
            { text: "Manage Memberships", link: "/customer-retention/manage-memberships" },
            { text: "Loyalty Rules", link: "/customer-retention/loyalty-rules" },
            { text: "Loyalty Transactions", link: "/customer-retention/loyalty-transactions" },
            { text: "Coupons", link: "/customer-retention/coupons" },
          ],
        },
        ...(hasRole(role, ["SUPER_ADMIN", "SALON_ADMIN"]) ? [
        { heading: "Expenses" },
        {
          icon: "money",
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
            { text: "Inventory Report", link: "/reports/inventory" },
            ...(hasRole(role, ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"])
              ? [{ text: "Audit Trails", link: "/reports/audit-trails" }]
              : []),
            ...(hasRole(role, ["SUPER_ADMIN", "SALON_ADMIN"])
              ? [{ text: "Salon Report", link: "/reports/salon-report" }]
              : []),
          ],
        },
      ]
    : []),
  ...(hasRole(role, ["SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST"])
    ? [
        {
          heading: "Administration",
        },
        {
          icon: "building",
          text: "Salon Management",
          link: "/management",
        },
      ]
    : []),
  ...(hasRole(role, ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"])
    ? [
        {
          icon: "setting",
          text: "Online Booking",
          link: "/settings/online-booking",
        },
      ]
    : []),
  { heading: "Help" },
  ...(hasRole(role, operationalRoles)
    ? [
        {
          icon: "help",
          text: role === "SUPER_ADMIN" ? "Support Queue" : "Support",
          link: "/support",
        },
      ]
    : []),
  {
    icon: "policy",
    text: "Terms & Policy",
    link: "/pages/terms-policy",
  },
  ];
};

export default getMenu;
