/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Col, Input, Label, Row } from "reactstrap";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { Button, Icon } from "@/components/Component";
import PageShell from "@/components/salon/PageShell";
import ReportExportButtons from "@/components/salon/ReportExportButtons";
import ServerPagination from "@/components/salon/ServerPagination";
import { CardTitle } from "@/pages/salon/SalonReport";
import { StatCard } from "@/pages/salon/SalesReport";
import { salonApi } from "@/services/salonApi";
import { formatDate, formatMoney, labelize, toLocalInput } from "@/utils/salonFormat";

Chart.register(ArcElement, BarElement, CategoryScale, Filler, LinearScale, LineElement, PointElement, Tooltip);

const PALETTE = ["#1c62f2", "#1aa37a", "#816bff", "#f4bd0e", "#e85347", "#09c2de", "#8091a7"];
const STATUS_COLOR = { ACTIVE: "success", EXPIRED: "warning", CANCELLED: "danger", REMOVED: "danger" };
const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_PAGE = 5;
const SOLD_PAGE = 10;

const localDay = (value) => toLocalInput(value).slice(0, 10);
const dayDate = (day) => new Date(`${day}T00:00:00`);
const shiftDay = (day, days) => localDay(new Date(dayDate(day).getTime() + days * DAY_MS));

/** Same-length window immediately before [from, to], for "vs previous period". */
const previousRange = (from, to) => {
  const days = Math.round((dayDate(to) - dayDate(from)) / DAY_MS) + 1;
  return { from: shiftDay(from, -days), to: shiftDay(from, -1) };
};

const percentChange = (current, previous) =>
  previous ? Math.round(((current - previous) / previous) * 100) : null;

const summarize = (rows) => {
  const amount = rows.reduce((sum, row) => sum + row.amount, 0);
  const pending = rows.filter((row) => row.method === "UNPAID");
  return {
    count: rows.length,
    amount,
    average: rows.length ? amount / rows.length : 0,
    pendingCount: pending.length,
    pendingAmount: pending.reduce((sum, row) => sum + row.amount, 0),
  };
};

const countBy = (rows, key) => {
  const counts = new Map();
  rows.forEach((row) => counts.set(row[key], (counts.get(row[key]) ?? 0) + 1));
  return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
};

/** Daily buckets for ranges up to two months, monthly beyond that. */
const trendBuckets = (rows, from, to) => {
  const days = rows.map((row) => localDay(row.createdAt)).sort();
  const start = from || days[0];
  const end = to || days[days.length - 1];
  if (!start || !end) return [];
  const monthly = (dayDate(end) - dayDate(start)) / DAY_MS > 62;
  const keyOf = (day) => (monthly ? day.slice(0, 7) : day);
  const counts = new Map();
  for (let day = start; day <= end; day = shiftDay(day, 1)) counts.set(keyOf(day), 0);
  for (const day of days) {
    if (counts.has(keyOf(day))) counts.set(keyOf(day), counts.get(keyOf(day)) + 1);
  }
  return Array.from(counts, ([key, count]) => ({
    label: monthly
      ? dayDate(`${key}-01`).toLocaleDateString(undefined, { month: "short", year: "2-digit" })
      : dayDate(key).toLocaleDateString(undefined, { day: "2-digit", month: "short" }),
    count,
  }));
};

const Trend = ({ change }) =>
  change === null ? (
    <span>No earlier data to compare</span>
  ) : (
    <>
      <span className={change >= 0 ? "text-success" : "text-danger"}>
        <Icon name={change >= 0 ? "arrow-up" : "arrow-down"} /> {Math.abs(change)}%
      </span>{" "}
      vs previous period
    </>
  );

const Empty = ({ children = "No memberships in this period" }) => (
  <div className="text-soft text-center py-5">{children}</div>
);

const chartScales = {
  x: { grid: { display: false } },
  y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "rgba(128,145,167,.15)" } },
};

const ChartCard = ({ icon, title, children }) => (
  <div className="card card-bordered dash-card h-100">
    <div className="card-inner">
      <div className="mb-3"><CardTitle icon={icon} title={title} /></div>
      {children}
    </div>
  </div>
);

const clientPage = (page, total, limit) => ({
  page,
  limit,
  total,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});

const CustomerCell = ({ customer }) => (
  <>
    <div className="fw-medium text-primary">{customer?.name ?? "—"}</div>
    <div className="fs-12px text-soft">{customer?.phone}</div>
  </>
);

const MembershipReport = () => {
  const [draft, setDraft] = useState({ from: "", to: "", plan: "", method: "" });
  const [filters, setFilters] = useState(draft);
  const [data, setData] = useState(null);
  const [previous, setPrevious] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expiryTab, setExpiryTab] = useState("soon");
  const [expiryPage, setExpiryPage] = useState(1);
  const [soldPage, setSoldPage] = useState(1);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const range = (from, to) => ({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
    try {
      const compare = filters.from && filters.to ? previousRange(filters.from, filters.to) : null;
      const [current, earlier] = await Promise.all([
        salonApi.reports.memberships(range(filters.from, filters.to)),
        compare ? salonApi.reports.memberships(range(compare.from, compare.to)) : null,
      ]);
      setData(current.data);
      setPrevious(earlier?.data ?? null);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [filters.from, filters.to]);

  useEffect(() => { load(); }, [load]);

  const matches = useCallback(
    (row) =>
      (!filters.plan || row.membershipNameSnapshot === filters.plan) &&
      (!filters.method || row.method === filters.method),
    [filters.plan, filters.method]
  );
  const sold = useMemo(() => (data?.sold ?? []).filter(matches), [data, matches]);
  const stats = summarize(sold);
  const before = previous ? summarize(previous.sold.filter(matches)) : null;
  const plans = countBy(sold, "membershipNameSnapshot");
  const planBars = plans.length > 6
    ? [...plans.slice(0, 5), { name: "Others", count: plans.slice(5).reduce((sum, row) => sum + row.count, 0) }]
    : plans;
  const methods = countBy(sold, "method");
  const trend = trendBuckets(sold, filters.from, filters.to);

  const planOptions = [...new Set((data?.sold ?? []).map((row) => row.membershipNameSnapshot))].sort();
  const methodOptions = [...new Set((data?.sold ?? []).map((row) => row.method))].sort();

  const term = search.trim().toLowerCase();
  const searched = term
    ? sold.filter((row) =>
        [row.customer?.name, row.customer?.phone, row.membershipNameSnapshot, row.soldByStaff?.name, row.invoiceCode]
          .some((value) => value?.toLowerCase().includes(term)))
    : sold;
  const soldRows = searched.slice((soldPage - 1) * SOLD_PAGE, soldPage * SOLD_PAGE);

  const expiryAll = expiryTab === "soon" ? data?.expiringSoon ?? [] : data?.expired ?? [];
  const expiryRows = expiryAll.slice((expiryPage - 1) * EXPIRY_PAGE, expiryPage * EXPIRY_PAGE);
  const warningDays = data?.warningDays ?? 10;

  const apply = () => {
    setFilters(draft);
    setSoldPage(1);
  };
  const setField = (key) => (event) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  const exportFilters = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));

  return (
    <PageShell
      title="Membership Report"
      description="Memberships sold, how they were paid, and who is about to expire or has expired."
    >
      {error && <Alert color="danger">{error}</Alert>}

      <div className="card card-bordered mb-4">
        <div className="card-inner">
          <Row className="g-3 align-items-end">
            <Col lg="4">
              <Label>Date range (sold)</Label>
              <div className="d-flex align-items-center dash-gap-2">
                <Input type="date" value={draft.from} max={draft.to || undefined} onChange={setField("from")} />
                <span className="text-soft">–</span>
                <Input type="date" value={draft.to} min={draft.from || undefined} onChange={setField("to")} />
              </div>
            </Col>
            <Col lg="3" sm="6">
              <Label>Plan</Label>
              <Input type="select" value={draft.plan} onChange={setField("plan")}>
                <option value="">All plans</option>
                {planOptions.map((plan) => <option key={plan} value={plan}>{plan}</option>)}
              </Input>
            </Col>
            <Col lg="3" sm="6">
              <Label>Payment method</Label>
              <Input type="select" value={draft.method} onChange={setField("method")}>
                <option value="">All methods</option>
                {methodOptions.map((method) => <option key={method} value={method}>{labelize(method)}</option>)}
              </Input>
            </Col>
            <Col lg="2" className="d-flex dash-gap-2">
              <Button color="primary" className="flex-grow-1 justify-content-center" onClick={apply}>
                <Icon name="filter" /><span>Apply filters</span>
              </Button>
              <Button color="light" outline className="btn-icon" title="Refresh" onClick={load}>
                <Icon name="reload" />
              </Button>
            </Col>
          </Row>
        </div>
      </div>

      <div className="dash-stats mb-4">
        <StatCard icon="users" color="primary" label="Total memberships" value={stats.count}
          note={before ? <Trend change={percentChange(stats.count, before.count)} /> : "All time"} />
        <StatCard icon="sign-inr" color="success" label="Total collected" value={formatMoney(stats.amount)}
          note={before ? <Trend change={percentChange(stats.amount, before.amount)} /> : "All time"} />
        <StatCard icon="clock" color="purple" label="Pending (unpaid bills)" value={stats.pendingCount}
          note={stats.pendingCount ? formatMoney(stats.pendingAmount) : "Nothing pending"} />
        <StatCard icon="cc-alt" color="danger" label="Avg. membership value" value={formatMoney(stats.average)}
          note={before ? <Trend change={percentChange(stats.average, before.average)} /> : "All time"} />
      </div>

      <Row className="g-gs mb-4">
        <Col xl="4" lg="6">
          <ChartCard icon="bar-chart" title="Memberships by plan">
            {planBars.length ? (
              <div style={{ height: 240 }}>
                <Bar
                  data={{
                    labels: planBars.map((row) => row.name),
                    datasets: [{ data: planBars.map((row) => row.count), backgroundColor: PALETTE[0], borderRadius: 4, maxBarThickness: 48 }],
                  }}
                  options={{ maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: chartScales }}
                />
              </div>
            ) : <Empty />}
          </ChartCard>
        </Col>
        <Col xl="4" lg="6">
          <ChartCard icon="wallet" title="Payment method distribution">
            {methods.length ? (
              <div className="d-flex align-items-center justify-content-center flex-wrap dash-gap-3">
                <div className="dash-donut">
                  <Doughnut
                    data={{
                      labels: methods.map((row) => labelize(row.name)),
                      datasets: [{ data: methods.map((row) => row.count), backgroundColor: methods.map((_, index) => PALETTE[index % PALETTE.length]), borderWidth: 2 }],
                    }}
                    options={{ cutout: "68%", maintainAspectRatio: false, plugins: { legend: { display: false } } }}
                  />
                  <div className="dash-donut-center">
                    <div className="fs-4 fw-bold">{stats.count}</div>
                    <div className="text-soft fs-11px">Total</div>
                  </div>
                </div>
                <ul className="list-plain flex-grow-1 mb-0">
                  {methods.map((row, index) => (
                    <li key={row.name} className="d-flex align-items-center dash-gap-2 py-1">
                      <span className="dash-dot" style={{ background: PALETTE[index % PALETTE.length] }} />
                      <span className="flex-grow-1">{labelize(row.name)}</span>
                      <span className="fw-medium">{Math.round((row.count / stats.count) * 100)}%</span>
                      <span className="text-soft">({row.count})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : <Empty />}
          </ChartCard>
        </Col>
        <Col xl="4">
          <ChartCard icon="trend-up" title="Membership trend">
            {stats.count ? (
              <div style={{ height: 240 }}>
                <Line
                  data={{
                    labels: trend.map((row) => row.label),
                    datasets: [{
                      label: "Memberships",
                      data: trend.map((row) => row.count),
                      borderColor: PALETTE[0],
                      backgroundColor: "rgba(28,98,242,.12)",
                      pointBackgroundColor: PALETTE[0],
                      pointRadius: trend.length > 31 ? 0 : 3,
                      fill: true,
                      tension: 0.35,
                    }],
                  }}
                  options={{
                    maintainAspectRatio: false,
                    interaction: { mode: "index", intersect: false },
                    plugins: { legend: { display: false } },
                    scales: { ...chartScales, x: { ...chartScales.x, ticks: { maxTicksLimit: 7 } } },
                  }}
                />
              </div>
            ) : <Empty />}
          </ChartCard>
        </Col>
      </Row>

      <Row className="g-gs">
        <Col xl="5">
          <div className="card card-bordered dash-card h-100">
            <div className="card-inner pb-0">
              <div className="d-flex align-items-center justify-content-between flex-wrap dash-gap-2">
                <CardTitle icon="clock" color="warning" title={expiryTab === "soon" ? `About to expire (next ${warningDays} days)` : "Expired memberships"} />
                <div className="btn-group btn-group-sm">
                  {[["soon", `Expiring (${data?.expiringSoon?.length ?? 0})`], ["expired", `Expired (${data?.expired?.length ?? 0})`]].map(([key, label]) => (
                    <Button key={key} size="sm" color={expiryTab === key ? "primary" : "light"} outline={expiryTab !== key}
                      onClick={() => { setExpiryTab(key); setExpiryPage(1); }}>
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            <div className="card-inner">
              {loading ? <Empty>Loading…</Empty> : expiryRows.length ? (
                <div className="table-responsive">
                  <table className="table table-sm mb-0">
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Membership</th>
                        <th>{expiryTab === "soon" ? "Expires on" : "Expired on"}</th>
                        <th className="text-end">{expiryTab === "soon" ? "Days left" : "Wallet lost"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expiryRows.map((row) => (
                        <tr key={row.id}>
                          <td><CustomerCell customer={row.customer} /></td>
                          <td>{row.membershipNameSnapshot}</td>
                          <td className="text-nowrap">{formatDate(row.expiresAt)}</td>
                          <td className="text-end">
                            {expiryTab === "soon" ? (
                              <Badge pill color={row.daysLeft <= 3 ? "danger" : "warning"}>{row.daysLeft}</Badge>
                            ) : formatMoney(row.forfeitedAmount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>{expiryTab === "soon" ? `Nothing expires in the next ${warningDays} days` : "No expired memberships"}</Empty>
              )}
              <div className="mt-3">
                <ServerPagination pagination={clientPage(expiryPage, expiryAll.length, EXPIRY_PAGE)} onPage={setExpiryPage} />
              </div>
            </div>
          </div>
        </Col>
        <Col xl="7">
          <div className="card card-bordered dash-card h-100">
            <div className="card-inner pb-0">
              <div className="d-flex align-items-center justify-content-between flex-wrap dash-gap-2">
                <CardTitle icon="users" title="All sold memberships" />
                <div className="d-flex align-items-center flex-wrap dash-gap-2">
                  <div className="form-control-wrap">
                    <div className="form-icon form-icon-left"><Icon name="search" /></div>
                    <Input
                      className="form-control-sm"
                      placeholder="Search customer, phone, plan…"
                      value={search}
                      onChange={(event) => { setSearch(event.target.value); setSoldPage(1); }}
                    />
                  </div>
                  <ReportExportButtons reportType="memberships" filters={exportFilters} />
                </div>
              </div>
            </div>
            <div className="card-inner">
              {loading ? <Empty>Loading…</Empty> : soldRows.length ? (
                <div className="table-responsive">
                  <table className="table table-sm mb-0">
                    <thead>
                      <tr>
                        <th>Sold on</th>
                        <th>Customer</th>
                        <th>Membership</th>
                        <th className="text-end">Amount</th>
                        <th>Payment</th>
                        <th>Sold by</th>
                        <th>Expires</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {soldRows.map((row) => (
                        <tr key={row.id}>
                          <td className="text-nowrap">{formatDate(row.createdAt)}</td>
                          <td><CustomerCell customer={row.customer} /></td>
                          <td>
                            {row.membershipNameSnapshot}
                            {row.invoiceCode && <div className="fs-12px text-soft">{row.invoiceCode}</div>}
                          </td>
                          <td className="text-end text-nowrap">{formatMoney(row.amount)}</td>
                          <td className={row.method === "UNPAID" ? "text-danger" : ""}>{labelize(row.method)}</td>
                          <td>{row.soldByStaff?.name ?? "—"}</td>
                          <td className="text-nowrap">{row.expiresAt ? formatDate(row.expiresAt) : "Never"}</td>
                          <td><Badge pill color={STATUS_COLOR[row.status] ?? "light"}>{labelize(row.status)}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>{term ? "No memberships match your search" : undefined}</Empty>
              )}
              <div className="mt-3">
                <ServerPagination pagination={clientPage(soldPage, searched.length, SOLD_PAGE)} onPage={setSoldPage} />
              </div>
            </div>
          </div>
        </Col>
      </Row>
    </PageShell>
  );
};

export default MembershipReport;
