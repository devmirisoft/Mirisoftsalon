import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Card, Col, Input, Row } from "reactstrap";
import { Bar, Doughnut } from "react-chartjs-2";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart,
  LinearScale,
  Tooltip,
} from "chart.js";
import { Icon } from "@/components/Component";
import Head from "@/layout/head/Head";
import Content from "@/layout/content/Content";
import StatusBadge from "@/components/salon/StatusBadge";
import { LoaderOne } from "@/components/ui/loader";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import { formatDate, formatMoney, labelize } from "@/utils/salonFormat";
import { groupPaymentsByMethod } from "@/utils/paymentMethods";

Chart.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip);

// Mirrors the requireRole guards on each backend list route, so a role never
// fires a request it is bound to get a 403 for. SUPER_ADMIN has no salonId and
// gets the platform-wide pair instead.
const endpointAccess = {
  salons: ["SUPER_ADMIN"],
  branches: ["SALON_ADMIN", "RECEPTIONIST"],
  staff: ["SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"],
  customers: ["SALON_ADMIN", "RECEPTIONIST", "STAFF"],
  services: ["SALON_ADMIN", "RECEPTIONIST", "STAFF"],
  appointments: ["SALON_ADMIN", "RECEPTIONIST", "STAFF"],
  invoices: ["SALON_ADMIN", "RECEPTIONIST", "STAFF"],
  payments: ["SALON_ADMIN", "RECEPTIONIST"],
  support: ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST", "STAFF"],
};

// Which roles see the salon's money widgets. STAFF can read invoices for
// billing but the takings are the owner's and the front desk's business.
const salesRoles = ["SALON_ADMIN", "RECEPTIONIST"];
const revenueRoles = ["SALON_ADMIN"];

const statMeta = {
  salons: { label: "Salons", icon: "building", color: "info", dateKey: "createdAt" },
  appointments: { label: "Appointments", icon: "calender-date", color: "primary", dateKey: "createdAt" },
  customers: { label: "Customers", icon: "users", color: "purple", dateKey: "createdAt" },
  staff: { label: "Staff", icon: "user-add", color: "success", dateKey: "createdAt" },
  branches: { label: "Branches", icon: "building", color: "info", dateKey: "createdAt" },
  services: { label: "Services", icon: "scissor", color: "danger", dateKey: "createdAt" },
  invoices: { label: "Invoices", icon: "file-docs", color: "orange", dateKey: "invoiceDate" },
  payments: { label: "Payments", icon: "sign-inr", color: "teal", dateKey: "paidAt" },
  support: { label: "Support Tickets", icon: "help", color: "warning", dateKey: "createdAt" },
};

const quickActions = [
  { label: "Book appointment", icon: "calender-date", to: "/appointments", roles: ["SALON_ADMIN", "RECEPTIONIST", "STAFF"] },
  { label: "Add customer", icon: "user-add", to: "/customers", roles: ["SALON_ADMIN", "RECEPTIONIST", "STAFF"] },
  { label: "Billing & payments", icon: "file-docs", to: "/billing", roles: ["SALON_ADMIN", "RECEPTIONIST", "STAFF"] },
  { label: "Create job cart", icon: "cart", to: "/job-carts/create", roles: ["SALON_ADMIN", "RECEPTIONIST"] },
  { label: "Add service", icon: "scissor", to: "/services", roles: ["SALON_ADMIN"] },
  { label: "Manage salon", icon: "building", to: "/management", roles: ["SUPER_ADMIN", "SALON_ADMIN"] },
  { label: "View reports", icon: "bar-chart", to: "/reports/sales", roles: ["SALON_ADMIN", "BRANCH_MANAGER", "RECEPTIONIST"] },
  { label: "Shift roster", icon: "clock", to: "/staff/shift-roster", roles: ["BRANCH_MANAGER", "STAFF"] },
  { label: "Attendance", icon: "calendar-check", to: "/staff-operations/attendance", roles: ["BRANCH_MANAGER", "STAFF"] },
  { label: "Leaves", icon: "calendar-booking", to: "/staff-operations/leaves", roles: ["BRANCH_MANAGER", "STAFF"] },
  { label: "Staff performance", icon: "growth", to: "/reports/staff-performance", roles: ["BRANCH_MANAGER"] },
  { label: "Salary slips", icon: "wallet", to: "/staff-operations/salary-slips", roles: ["BRANCH_MANAGER", "STAFF"] },
  { label: "Support", icon: "help", to: "/support", roles: ["SUPER_ADMIN", "RECEPTIONIST", "STAFF"] },
];

const DAY = 86400000;
const BLUES = ["#1e3a8a", "#2563eb", "#3b82f6", "#60a5fa", "#93c5fd"];
const AXIS = { color: "#8094ae" };
const GRID = { color: "rgba(128, 148, 174, 0.18)" };
const inactive = ["CANCELLED", "NO_SHOW"];

const startOfDay = (time) => new Date(new Date(time).toDateString()).getTime();

// Rows dated in the last 7 days against the 7 before that; null when there is
// no prior week to compare with.
const weekTrend = (rows, dateKey, now) => {
  let current = 0;
  let previous = 0;
  rows.forEach((row) => {
    const age = now - new Date(row[dateKey]).getTime();
    if (age >= 0 && age < 7 * DAY) current += 1;
    else if (age >= 7 * DAY && age < 14 * DAY) previous += 1;
  });
  return previous ? Math.round(((current - previous) / previous) * 100) : null;
};

const initials = (name = "") =>
  name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";

const Homepage = () => {
  const { user } = useAuth();
  const role = user?.role;
  const [salesDays, setSalesDays] = useState(7);
  const [state, setState] = useState({ loading: true, error: "", data: {}, loadedAt: 0 });

  useEffect(() => {
    let active = true;
    const load = async () => {
      const calls = {
        salons: () => salonApi.salons.list(),
        appointments: () => salonApi.appointments.list(),
        customers: () => salonApi.customers.list(),
        staff: () => salonApi.staff.list(),
        branches: () => salonApi.branches.list(),
        services: () => salonApi.services.list(),
        invoices: () => salonApi.invoices.list(),
        payments: () => salonApi.payments.list(),
        support: () =>
          role === "SUPER_ADMIN" ? salonApi.support.list() : salonApi.support.mine(),
      };
      const allowed = Object.entries(calls).filter(([key]) => endpointAccess[key].includes(role));
      const results = await Promise.allSettled(allowed.map(([, call]) => call()));
      const data = {};
      results.forEach((result, index) => {
        data[allowed[index][0]] =
          result.status === "fulfilled" && Array.isArray(result.value.data) ? result.value.data : [];
      });
      if (active) setState({ loading: false, error: "", data, loadedAt: Date.now() });
    };
    load().catch((error) => {
      if (active) {
        setState({
          loading: false,
          error: error instanceof Error ? error.message : "Unable to load dashboard.",
          data: {},
          loadedAt: Date.now(),
        });
      }
    });
    return () => {
      active = false;
    };
  }, [role]);

  const { data, loadedAt: now } = state;
  const appointments = data.appointments || [];
  const invoices = data.invoices || [];
  const payments = data.payments || [];
  const services = data.services || [];

  const statCount = Object.keys(data).length;
  const showSales = salesRoles.includes(role);
  const showRevenue = revenueRoles.includes(role);
  const showAppointments = endpointAccess.appointments.includes(role);
  const actions = quickActions.filter((action) => action.roles.includes(role));

  const todayStart = startOfDay(now);
  const todayAppointments = appointments
    .filter(
      (item) =>
        startOfDay(item.startTime) === todayStart && !inactive.includes(item.status)
    )
    .sort((left, right) => new Date(left.startTime) - new Date(right.startTime));
  const upcomingAppointments = appointments
    .filter((item) => new Date(item.startTime).getTime() >= now && !inactive.includes(item.status))
    .sort((left, right) => new Date(left.startTime) - new Date(right.startTime));

  const outstanding = invoices
    .filter((invoice) => invoice.status !== "CANCELLED")
    .reduce((total, invoice) => total + Number(invoice.balanceAmount || 0), 0);
  const received = payments.reduce((total, payment) => total + Number(payment.amount || 0), 0);
  // Same rows as the headline figure, split by tender so the counter can see
  // how much of the till is cash versus GPay, card and the rest.
  const receivedByMethod = groupPaymentsByMethod(payments);

  const sales = (() => {
    const days = Array.from({ length: salesDays }, (_, index) => todayStart - (salesDays - 1 - index) * DAY);
    const totals = new Map(days.map((day) => [day, 0]));
    payments.forEach((payment) => {
      const day = startOfDay(payment.paidAt);
      if (totals.has(day)) totals.set(day, totals.get(day) + Number(payment.amount || 0));
    });
    return {
      labels: days.map((day) =>
        new Date(day).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
      ),
      values: days.map((day) => totals.get(day)),
    };
  })();

  // Billed value this month by service category; products, packages and
  // memberships are their own slices. Top four kept, the rest fold into Others.
  const revenue = (() => {
    const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();
    const categoryOf = new Map(services.map((service) => [service.id, service.mainService?.name]));
    const totals = new Map();
    invoices
      .filter(
        (invoice) =>
          invoice.status !== "CANCELLED" && new Date(invoice.invoiceDate).getTime() >= monthStart
      )
      .flatMap((invoice) => invoice.items || [])
      .forEach((item) => {
        const label =
          item.itemType === "SERVICE"
            ? categoryOf.get(item.serviceId) || "Services"
            : labelize(item.itemType);
        totals.set(label, (totals.get(label) || 0) + Number(item.lineTotal || 0));
      });
    const rows = [...totals].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
    const top = rows.slice(0, 4);
    const rest = rows.slice(4).reduce((sum, [, value]) => sum + value, 0);
    if (rest > 0) top.push(["Others", rest]);
    const total = top.reduce((sum, [, value]) => sum + value, 0);
    return { rows: top, total };
  })();

  const todayLabel = new Date(now).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const todayCard = (
    <Card className="card-bordered dash-card">
      <div className="card-inner">
        <div className="dash-card-head">
          <h6 className="title mb-0">Today&apos;s Bookings</h6>
          <Link to="/appointments">View all</Link>
        </div>
        <div className="d-flex align-items-center dash-gap-3 mt-3">
          <div className="dash-icon bg-primary-dim text-primary">
            <Icon name="calender-date" />
          </div>
          <div>
            <span className="fs-3 fw-bold me-2">{todayAppointments.length}</span>
            <span className="text-soft">
              {todayAppointments.length ? "bookings today" : "No bookings yet"}
            </span>
          </div>
        </div>
        {todayAppointments.length === 0 ? (
          <p className="text-soft fs-12px mt-2 mb-0">A busy day starts with a single booking.</p>
        ) : (
          <ul className="list-plain mt-2 mb-0 fs-12px">
            {todayAppointments.slice(0, 3).map((item) => (
              <li key={item.id} className="d-flex justify-content-between">
                <span>{item.customer?.name}</span>
                <span className="text-soft">
                  {new Date(item.startTime).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );

  return (
    <>
      <Head title="Dashboard" />
      <Content>
        <div className="dash-hero">
          <div>
            <h3 className="dash-hero-title">Welcome, {user?.name || "Salon user"} 👋</h3>
            <p className="text-soft mb-0">
              Here&apos;s what&apos;s happening at your salon today · {labelize(role)}
            </p>
          </div>
          <div className="dash-hero-side">
            <span className="dash-date">
              <Icon name="calendar" /> {now ? todayLabel : ""}
            </span>
            <span className="dash-tagline">Self Care Looks Good On You</span>
          </div>
        </div>

        {state.error && <Alert color="danger">{state.error}</Alert>}
        {state.loading ? (
          <div className="text-center py-5">
            <LoaderOne label="Building your live salon overview" />
            <p className="text-soft mt-2">Building your live salon overview...</p>
          </div>
        ) : (
          <>
            {/* One row up to six tiles, otherwise two even rows. */}
            <div
              className="dash-stats"
              style={{ "--dash-cols": statCount > 6 ? Math.ceil(statCount / 2) : statCount }}
            >
              {Object.entries(data).map(([key, rows]) => {
                const meta = statMeta[key];
                const trend = weekTrend(rows, meta.dateKey, now);
                return (
                  <Card className="card-bordered dash-card" key={key}>
                    <div className="card-inner d-flex dash-gap-3 align-items-start">
                      <div className={`dash-icon bg-${meta.color}-dim text-${meta.color}`}>
                        <Icon name={meta.icon} />
                      </div>
                      <div>
                        <div className="fs-3 fw-bold lh-1">{rows.length}</div>
                        <div className="text-soft fs-13px">{meta.label}</div>
                        <div className="fs-12px mt-1 text-nowrap">
                          {trend === null ? (
                            <span className="text-soft">— vs last week</span>
                          ) : (
                            <>
                              <span className={trend > 0 ? "text-success" : trend < 0 ? "text-danger" : "text-soft"}>
                                {trend > 0 ? "↑" : trend < 0 ? "↓" : ""} {Math.abs(trend)}%
                              </span>{" "}
                              <span className="text-soft">vs last week</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>

            {showSales && (
              <Row className="g-gs mt-0">
                <Col lg={showRevenue ? 4 : 8}>
                  <Card className="card-bordered dash-card h-100">
                    <div className="card-inner">
                      <div className="dash-card-head">
                        <h6 className="title mb-0">Sales Overview</h6>
                        <Input
                          type="select"
                          bsSize="sm"
                          className="w-auto"
                          value={salesDays}
                          onChange={(event) => setSalesDays(Number(event.target.value))}
                          aria-label="Sales range"
                        >
                          <option value={7}>Last 7 Days</option>
                          <option value={30}>Last 30 Days</option>
                        </Input>
                      </div>
                      <div className="dash-chart">
                        <Bar
                          data={{
                            labels: sales.labels,
                            datasets: [
                              {
                                label: "Received",
                                data: sales.values,
                                backgroundColor: "#3b82f6",
                                hoverBackgroundColor: "#1e3a8a",
                                borderRadius: 4,
                                maxBarThickness: 28,
                              },
                            ],
                          }}
                          options={{
                            maintainAspectRatio: false,
                            plugins: {
                              legend: { display: false },
                              tooltip: { callbacks: { label: (item) => formatMoney(item.raw) } },
                            },
                            scales: {
                              x: {
                                grid: { display: false },
                                ticks: { ...AXIS, maxRotation: 0, autoSkip: true, autoSkipPadding: 8 },
                              },
                              y: {
                                beginAtZero: true,
                                grid: GRID,
                                border: { display: false },
                                ticks: { ...AXIS, callback: (value) => `₹${Number(value).toLocaleString("en-IN")}` },
                              },
                            },
                          }}
                        />
                      </div>
                    </div>
                  </Card>
                </Col>

                {showRevenue && (
                  <Col lg="4">
                    <Card className="card-bordered dash-card h-100">
                      <div className="card-inner">
                        <div className="dash-card-head">
                          <h6 className="title mb-0">Revenue Breakdown</h6>
                          <span className="badge bg-light text-dark">This Month</span>
                        </div>
                        {revenue.total === 0 ? (
                          <p className="text-soft text-center py-5 mb-0">No billing this month yet.</p>
                        ) : (
                          <div className="d-flex align-items-center dash-gap-3 dash-donut-row">
                            <div className="dash-donut">
                              <Doughnut
                                data={{
                                  labels: revenue.rows.map(([label]) => label),
                                  datasets: [
                                    {
                                      data: revenue.rows.map(([, value]) => value),
                                      backgroundColor: BLUES,
                                      borderWidth: 2,
                                    },
                                  ],
                                }}
                                options={{
                                  cutout: "68%",
                                  maintainAspectRatio: false,
                                  plugins: {
                                    legend: { display: false },
                                    tooltip: {
                                      callbacks: { label: (item) => `${item.label}: ${formatMoney(item.raw)}` },
                                    },
                                  },
                                }}
                              />
                              <div className="dash-donut-center">
                                <div className="fw-bold">{formatMoney(revenue.total)}</div>
                                <div className="text-soft fs-11px">Total billed</div>
                              </div>
                            </div>
                            <ul className="list-plain flex-grow-1 mb-0 fs-12px">
                              {revenue.rows.map(([label, value], index) => (
                                <li key={label} className="d-flex align-items-center dash-gap-2 py-1">
                                  <span className="dash-dot" style={{ background: BLUES[index] }} />
                                  <span className="flex-grow-1">{label}</span>
                                  <span className="text-soft">
                                    {Math.round((value / revenue.total) * 100)}%
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </Card>
                  </Col>
                )}

                <Col lg="4">
                  <div className="d-flex flex-column dash-gap-3 h-100">
                    {todayCard}
                    <Row className="g-3">
                      <Col xs="6">
                        <Card className="card-bordered dash-card h-100">
                          <div className="card-inner">
                            <div className="d-flex align-items-center dash-gap-2 text-soft fs-12px text-nowrap">
                              <span className="dash-icon sm bg-danger-dim text-danger">
                                <Icon name="file-docs" />
                              </span>
                              Outstanding
                            </div>
                            <div className="fs-5 fw-bold text-danger mt-2">{formatMoney(outstanding)}</div>
                          </div>
                        </Card>
                      </Col>
                      <Col xs="6">
                        <Card className="card-bordered dash-card h-100">
                          <div className="card-inner">
                            <div className="d-flex align-items-center dash-gap-2 text-soft fs-12px text-nowrap">
                              <span className="dash-icon sm bg-success-dim text-success">
                                <Icon name="wallet" />
                              </span>
                              Total Received
                            </div>
                            <div className="fs-5 fw-bold text-success mt-2">{formatMoney(received)}</div>
                            {receivedByMethod.length > 0 && (
                              <ul className="list-plain mt-2 mb-0 fs-11px">
                                {receivedByMethod.map((row) => (
                                  <li key={row.method} className="d-flex justify-content-between">
                                    <span className="text-soft">{row.label}</span>
                                    <span>{formatMoney(row.amount)}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </Card>
                      </Col>
                    </Row>
                  </div>
                </Col>
              </Row>
            )}

            <Row className="g-gs mt-0">
              {showAppointments && (
                <Col lg="7">
                  <Card className="card-bordered dash-card h-100">
                    <div className="card-inner">
                      <div className="dash-card-head mb-3">
                        <h6 className="title mb-0">Upcoming Appointments</h6>
                        <Link to="/appointments">View all</Link>
                      </div>
                      <div className="table-responsive">
                        <table className="table dash-table mb-0">
                          <thead>
                            <tr>
                              <th>Code</th>
                              <th>Customer</th>
                              <th>Staff</th>
                              <th>Schedule</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {upcomingAppointments.slice(0, 6).map((appointment) => (
                              <tr key={appointment.id}>
                                <td>{appointment.appointmentCode}</td>
                                <td>
                                  <div className="d-flex align-items-center dash-gap-2">
                                    <span className="user-avatar xs dash-avatar">
                                      <span>{initials(appointment.customer?.name)}</span>
                                    </span>
                                    {appointment.customer?.name}
                                  </div>
                                </td>
                                <td>{appointment.staff?.name}</td>
                                <td>{formatDate(appointment.startTime, true)}</td>
                                <td><StatusBadge value={appointment.status} /></td>
                              </tr>
                            ))}
                            {upcomingAppointments.length === 0 && (
                              <tr>
                                <td colSpan="5" className="text-center text-soft py-4">
                                  No upcoming appointments.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </Card>
                </Col>
              )}
              <Col lg={showAppointments ? 5 : 12}>
                <div className="d-flex flex-column dash-gap-3 h-100">
                  {showAppointments && !showSales && todayCard}
                  <Card className="card-bordered dash-card flex-grow-1">
                    <div className="card-inner">
                      <h6 className="title mb-3">Quick actions</h6>
                      <div className="dash-actions">
                        {actions.map((action) => (
                          <Link key={action.to} to={action.to} className="dash-action">
                            <Icon name={action.icon} />
                            <span>{action.label}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  </Card>
                </div>
              </Col>
            </Row>
          </>
        )}
      </Content>
    </>
  );
};

export default Homepage;
