/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import {
  Alert,
  Col,
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
  Input,
  Label,
  Row,
  Spinner,
  UncontrolledDropdown,
} from "reactstrap";
import { Link } from "react-router-dom";
import { Doughnut, Line } from "react-chartjs-2";
import {
  ArcElement,
  CategoryScale,
  Chart,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { Button, Icon, RSelect } from "@/components/Component";
import PageShell from "@/components/salon/PageShell";
import ReportExportButtons from "@/components/salon/ReportExportButtons";
import { useAuth } from "@/auth/AuthContext";
import { useTheme } from "@/layout/provider/Theme";
import { salonApi } from "@/services/salonApi";
import { allowsRole, formatDate, formatMoney, labelize } from "@/utils/salonFormat";

Chart.register(
  ArcElement,
  CategoryScale,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip
);

/**
 * Other pages register Legend globally, so every chart here has to opt out
 * explicitly or Chart.js draws the dataset's missing label as "undefined".
 */
const NO_LEGEND = { legend: { display: false } };

const PAYMENT_METHODS = [
  "CASH", "UPI", "GPAY", "PAYTM", "PHONEPE", "CARD",
  "BANK_TRANSFER", "CHEQUE", "MEMBERSHIP_WALLET", "OTHER",
];

// labelize() title-cases, which turns the acronyms into "Upi" and "Gpay".
const METHOD_LABELS = {
  UPI: "UPI",
  GPAY: "GPay",
  PHONEPE: "PhonePe",
};

const methodLabel = (method) => METHOD_LABELS[method] ?? labelize(method);

const METHOD_OPTIONS = PAYMENT_METHODS.map((method) => ({
  value: method,
  label: methodLabel(method),
}));

/**
 * Four fixed buckets, so a hue always means the same way of paying and a quiet
 * day never repaints the others. Anything not listed falls into "Other".
 */
const MODE_GROUPS = [
  { key: "CASH", label: "Cash", methods: ["CASH"] },
  { key: "UPI", label: "UPI", methods: ["UPI", "GPAY", "PAYTM", "PHONEPE"] },
  { key: "CARD", label: "Card", methods: ["CARD"] },
  { key: "OTHER", label: "Other", methods: [] },
];

// Both sets are checked against the six colour rules (lightness band, chroma,
// CVD separation, normal-vision separation, contrast) on their own surface —
// dark is its own set of steps, not a flip of the light one.
const MODE_COLORS = {
  light: { CASH: "#6355d6", UPI: "#0d9488", CARD: "#b45309", OTHER: "#0369a1" },
  dark: { CASH: "#8878e6", UPI: "#0fa08f", CARD: "#bf8400", OTHER: "#3b8fcc" },
};

const PERIODS = [
  ["day", "Today"],
  ["week", "This week"],
  ["month", "This month"],
];

const EMPTY = {
  period: "day",
  from: "",
  to: "",
  phone: "",
  name: "",
  invoiceNo: "",
  methods: [],
};

const shortDay = (day) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });

const percentChange = (current, previous) => {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
};

/** A headline number, its movement, and — only where the series is really
 *  this tile's own — a sparkline of it. */
const StatTile = ({ tone, icon, label, value, delta, share, spark, color }) => (
  <Col sm="6" xl="3">
    <div className={`card card-bordered h-100 eod-tile eod-tile-${tone}`}>
      <div className="card-inner">
        <div className="d-flex align-items-center gap-2">
          <span className="eod-tile-icon">
            <Icon name={icon} />
          </span>
          <span className="eod-tile-label">{label}</span>
        </div>
        <div className="eod-tile-value">{value}</div>
        <div className="eod-tile-foot">
          {delta !== null && delta !== undefined ? (
            <span className={`eod-tile-delta ${delta < 0 ? "is-down" : "is-up"}`}>
              <Icon name={delta < 0 ? "arrow-long-down" : "arrow-long-up"} />
              {Math.abs(delta).toFixed(0)}% vs. previous
            </span>
          ) : (
            <span className="eod-tile-delta is-flat">{share ?? "No earlier data"}</span>
          )}
          {spark?.length ? (
            <span className="eod-tile-spark" aria-hidden="true">
              <Line
                data={{
                  labels: spark.map((point) => point.day),
                  datasets: [
                    {
                      data: spark.map((point) => point.value),
                      borderColor: color,
                      borderWidth: 2,
                      fill: true,
                      backgroundColor: `${color}1f`,
                      pointRadius: 0,
                      tension: 0.35,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { ...NO_LEGEND, tooltip: { enabled: false } },
                  scales: { x: { display: false }, y: { display: false } },
                  elements: { line: { capBezierPoints: true } },
                }}
              />
            </span>
          ) : null}
        </div>
      </div>
    </div>
  </Col>
);

const EodReport = () => {
  const { user } = useAuth();
  const theme = useTheme();
  const colors = MODE_COLORS[theme.skin === "dark" ? "dark" : "light"];
  const surface = theme.skin === "dark" ? "#1c2b46" : "#ffffff";
  const axisInk = theme.skin === "dark" ? "#8091a7" : "#8094ae";
  const gridInk = theme.skin === "dark" ? "rgba(255,255,255,0.08)" : "rgba(17,24,39,0.07)";
  // Invoice cancel is admin-only on the backend.
  const canTrash = allowsRole(["SUPER_ADMIN", "SALON_ADMIN"], user?.role);
  const [search, setSearch] = useState(EMPTY);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [topTab, setTopTab] = useState("services");

  // The filters are applied by the server, so the query mirrors the form and
  // the exports below are handed the same values. An explicit date beats the
  // preset: any from/to makes the window custom.
  const queryFor = (values) => ({
    period: values.from || values.to ? "custom" : values.period || "day",
    ...(values.from ? { from: values.from } : {}),
    ...(values.to ? { to: values.to } : {}),
    ...(values.phone ? { phone: values.phone } : {}),
    ...(values.name ? { name: values.name } : {}),
    ...(values.invoiceNo ? { invoiceNo: values.invoiceNo } : {}),
    ...(values.methods.length ? { methods: values.methods.join(",") } : {}),
  });

  const load = async (values = search) => {
    setLoading(true);
    setError("");
    try {
      const response = await salonApi.reports.eod(queryFor(values));
      setData(response.data);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  // First paint shows the salon's own today; the server picks that default.
  useEffect(() => {
    load(EMPTY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => {
    setSearch(EMPTY);
    load(EMPTY);
  };

  const set = (key) => (event) =>
    setSearch((current) => ({ ...current, [key]: event.target.value }));

  // "Make trash" cancels the invoice: that reverses stock, packages and
  // balances, and keeps the invoice number on record for GST.
  const makeTrash = async (row) => {
    if (!window.confirm(`Trash invoice ${row.invoiceCode}? This cancels the invoice.`)) return;
    try {
      await salonApi.invoices.cancel(row.id);
      await load();
    } catch (trashError) {
      setError(trashError.message);
    }
  };

  // Switching preset drops any hand-picked date, so the window shown is the
  // preset; picking a date does the reverse.
  const pickPeriod = (period) => {
    const next = { ...search, period, from: "", to: "" };
    setSearch(next);
    load(next);
  };

  const pickDay = (value) => {
    if (!value) return;
    const next = { ...EMPTY, from: value, to: value };
    setSearch(next);
    load(next);
  };

  const rows = data?.rows ?? [];
  const trend = data?.trend ?? [];
  const totalBilling = data?.totalBillingCost ?? 0;
  const received = (data?.cashReceived ?? 0) + (data?.onlineReceived ?? 0);
  const shareOf = (value) =>
    received ? `${Math.round((value / received) * 100)}% of collected` : "Nothing collected yet";

  // Fold every method into its fixed bucket so the ring always has the same
  // four slices in the same order.
  const modeTotals = MODE_GROUPS.map((group) => {
    const matched = (data?.paymentModes ?? []).filter((mode) =>
      group.key === "OTHER"
        ? !MODE_GROUPS.some((other) => other.methods.includes(mode.method))
        : group.methods.includes(mode.method)
    );
    return { ...group, amount: matched.reduce((sum, mode) => sum + mode.amount, 0) };
  });
  const modeTotal = modeTotals.reduce((sum, mode) => sum + mode.amount, 0);
  const topRows = (topTab === "services" ? data?.topServices : data?.topProducts) ?? [];

  // The export reads the window the server resolved, so a default "today"
  // downloads today rather than every invoice ever billed.
  const exportFilters = {
    ...queryFor(search),
    ...(data?.range?.from ? { from: data.range.from } : {}),
    ...(data?.range?.to ? { to: data.range.to } : {}),
  };

  const today = new Date().toLocaleDateString("en-CA");
  const pickedDay = data?.range?.from === data?.range?.to ? data?.range?.from ?? "" : "";
  const rangeLabel = () => {
    const { from, to } = data?.range ?? {};
    if (!from) return "Pick a date";
    if (from !== to) return `${shortDay(from)} – ${shortDay(to)}`;
    return from === today ? `Today, ${shortDay(from)}` : shortDay(from);
  };

  return (
    <PageShell
      className="eod-page"
      title="EOD Report"
      description="End-of-day cash-up: every bill raised in the window, with its service and product split."
      tools={
        <UncontrolledDropdown>
          <DropdownToggle tag="button" type="button" className="eod-range-chip">
            <Icon name="calendar" />
            <span>{rangeLabel()}</span>
            <Icon name="chevron-down" className="eod-range-caret" />
          </DropdownToggle>
          <DropdownMenu end className="eod-range-menu">
            {PERIODS.map(([value, label]) => (
              <DropdownItem
                key={value}
                tag="button"
                type="button"
                active={!search.from && !search.to && search.period === value}
                onClick={() => pickPeriod(value)}
              >
                {label}
              </DropdownItem>
            ))}
            <DropdownItem divider />
            {/* A native date input, so the calendar is the platform's own.
                toggle=false keeps the menu open while the picker is used. */}
            <DropdownItem tag="div" toggle={false} className="eod-range-pick">
              <Label for="eod-pick-date">Specific date</Label>
              <Input
                id="eod-pick-date"
                type="date"
                max={today}
                value={pickedDay}
                onChange={(event) => pickDay(event.target.value)}
              />
            </DropdownItem>
          </DropdownMenu>
        </UncontrolledDropdown>
      }
    >
      {error && <Alert color="danger">{error}</Alert>}

      <Row className="g-gs mb-4">
        <StatTile
          tone="mint"
          icon="wallet-in"
          label="Total Billing Amount"
          value={formatMoney(totalBilling)}
          delta={percentChange(totalBilling, data?.previous?.totalBillingCost)}
          spark={trend.map((point) => ({ day: point.day, value: point.amount }))}
          color={colors.UPI}
        />
        <StatTile
          tone="sky"
          icon="coins"
          label="Cash Received"
          value={formatMoney(data?.cashReceived ?? 0)}
          share={shareOf(data?.cashReceived ?? 0)}
          color={colors.CASH}
        />
        <StatTile
          tone="lilac"
          icon="card-view"
          label="UPI / Card / Online"
          value={formatMoney(data?.onlineReceived ?? 0)}
          share={shareOf(data?.onlineReceived ?? 0)}
          color={colors.OTHER}
        />
        <StatTile
          tone="rose"
          icon="file-docs"
          label="Total Sales (Bills)"
          value={data?.totalSales ?? 0}
          delta={percentChange(data?.totalSales ?? 0, data?.previous?.totalSales)}
          spark={trend.map((point) => ({ day: point.day, value: point.count }))}
          color={colors.CARD}
        />
      </Row>

      <Row className="g-gs mb-4">
        <Col xl="4" lg="6">
          <div className="card card-bordered h-100">
            <div className="card-inner">
              <h6 className="eod-card-title">Payment Mode Breakdown</h6>
              {modeTotal ? (
                <div className="eod-donut-wrap">
                  <div className="eod-donut">
                    <Doughnut
                      data={{
                        labels: modeTotals.map((mode) => mode.label),
                        datasets: [
                          {
                            data: modeTotals.map((mode) => mode.amount),
                            backgroundColor: modeTotals.map((mode) => colors[mode.key]),
                            // A 2px ring in the surface colour keeps a gap
                            // between neighbouring slices.
                            borderColor: surface,
                            borderWidth: 2,
                          },
                        ],
                      }}
                      options={{
                        cutout: "70%",
                        maintainAspectRatio: false,
                        plugins: {
                          ...NO_LEGEND,
                          tooltip: {
                            callbacks: {
                              label: (item) => `${item.label}: ${formatMoney(item.raw)}`,
                            },
                          },
                        },
                      }}
                    />
                    <div className="eod-donut-center">
                      <div className="eod-donut-total">{formatMoney(modeTotal)}</div>
                      <div className="eod-donut-caption">Collected</div>
                    </div>
                  </div>
                  <ul className="eod-legend">
                    {modeTotals.map((mode) => (
                      <li key={mode.key}>
                        <span
                          className="eod-legend-dot"
                          style={{ backgroundColor: colors[mode.key] }}
                        />
                        <span className="eod-legend-name">{mode.label}</span>
                        <span className="eod-legend-share">
                          {Math.round((mode.amount / modeTotal) * 100)}%
                        </span>
                        <span className="eod-legend-value">{formatMoney(mode.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="text-soft py-4 text-center">
                  Nothing collected in this window
                </div>
              )}
            </div>
          </div>
        </Col>

        <Col xl="5" lg="6">
          <div className="card card-bordered h-100">
            <div className="card-inner">
              <h6 className="eod-card-title">Billing Trend (last 7 days)</h6>
              <div className="eod-trend">
                <Line
                  data={{
                    labels: trend.map((point) => shortDay(point.day)),
                    datasets: [
                      {
                        label: "Billed",
                        data: trend.map((point) => point.amount),
                        borderColor: colors.CASH,
                        backgroundColor: `${colors.CASH}1f`,
                        borderWidth: 2,
                        fill: true,
                        tension: 0.35,
                        pointRadius: 3,
                        pointHoverRadius: 5,
                        pointBackgroundColor: surface,
                        pointBorderColor: colors.CASH,
                        pointBorderWidth: 2,
                      },
                    ],
                  }}
                  options={{
                    maintainAspectRatio: false,
                    // A single series needs no legend — the title names it.
                    interaction: { mode: "index", intersect: false },
                    plugins: {
                      ...NO_LEGEND,
                      tooltip: {
                        displayColors: false,
                        callbacks: { label: (item) => formatMoney(item.raw) },
                      },
                    },
                    scales: {
                      x: {
                        grid: { display: false },
                        border: { color: gridInk },
                        ticks: { color: axisInk, font: { size: 11 } },
                      },
                      y: {
                        beginAtZero: true,
                        border: { display: false },
                        grid: { color: gridInk },
                        ticks: {
                          color: axisInk,
                          font: { size: 11 },
                          maxTicksLimit: 5,
                          callback: (value) => `₹${Number(value).toLocaleString("en-IN")}`,
                        },
                      },
                    },
                  }}
                />
              </div>
            </div>
          </div>
        </Col>

        <Col xl="3" lg="12">
          <div className="card card-bordered h-100">
            <div className="card-inner">
              <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                <h6 className="eod-card-title mb-0">Top Services &amp; Products</h6>
                <div className="eod-toggle" role="tablist">
                  {["services", "products"].map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={topTab === tab}
                      className={topTab === tab ? "is-active" : ""}
                      onClick={() => setTopTab(tab)}
                    >
                      {labelize(tab)}
                    </button>
                  ))}
                </div>
              </div>
              <ul className="eod-top-list">
                {topRows.map((row) => (
                  <li key={row.name}>
                    <span className="eod-top-mark" aria-hidden="true">
                      <Icon name={topTab === "services" ? "scissor" : "package"} />
                    </span>
                    <span className="eod-top-name" title={row.name}>{row.name}</span>
                    <span className="eod-top-count">{row.count}</span>
                    <span className="eod-top-value">{formatMoney(row.amount)}</span>
                  </li>
                ))}
                {!topRows.length && (
                  <li className="eod-top-empty text-soft">No {topTab} sold in this window</li>
                )}
              </ul>
            </div>
          </div>
        </Col>
      </Row>

      <div className="card card-bordered mb-4">
        <div className="card-inner">
          <h6 className="eod-card-title eod-filters-title">
            <Icon name="filter-alt" />
            <span>Filters &amp; Search</span>
          </h6>
          <Row className="g-3">
            <Col md="6" xl="3">
              <Label for="eod-from">Start Date</Label>
              <Input id="eod-from" type="date" value={search.from} onChange={set("from")} />
            </Col>
            <Col md="6" xl="3">
              <Label for="eod-to">End Date</Label>
              <Input id="eod-to" type="date" value={search.to} onChange={set("to")} />
            </Col>
            <Col md="6" xl="3">
              <Label for="eod-phone">Phone Number</Label>
              <Input
                id="eod-phone"
                placeholder="Search by phone number"
                value={search.phone}
                onChange={set("phone")}
              />
            </Col>
            <Col md="6" xl="3">
              <Label for="eod-name">Name</Label>
              <Input
                id="eod-name"
                placeholder="Search by name"
                value={search.name}
                onChange={set("name")}
              />
            </Col>
            <Col md="6" xl="3">
              <Label for="eod-invoice">Invoice No</Label>
              <Input
                id="eod-invoice"
                placeholder="Search by invoice no"
                value={search.invoiceNo}
                onChange={set("invoiceNo")}
              />
            </Col>
            <Col md="6" xl="3">
              <Label>Mode of Payment</Label>
              <RSelect
                isMulti
                options={METHOD_OPTIONS}
                placeholder="All selected"
                value={METHOD_OPTIONS.filter((option) =>
                  search.methods.includes(option.value)
                )}
                onChange={(selected) =>
                  setSearch((current) => ({
                    ...current,
                    methods: (selected ?? []).map((option) => option.value),
                  }))
                }
              />
              <div className="fs-12px text-soft mt-1">
                {search.methods.length ? `${search.methods.length} selected` : "All selected"}
              </div>
            </Col>
            <Col xl="6" className="eod-filter-actions">
              <Button color="primary" onClick={() => load()}>
                <Icon name="search" />
                <span>Search</span>
              </Button>
              <Button color="light" outline onClick={reset}>
                <Icon name="reload" />
                <span>Reset Search</span>
              </Button>
              <ReportExportButtons reportType="eod" filters={exportFilters} />
            </Col>
          </Row>
          {data?.range?.from && (
            <div className="text-soft fs-12px mt-3">
              Showing {data.range.from} to {data.range.to} ({data.range.timezone})
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-5">
          <Spinner color="primary" />
        </div>
      ) : (
        <div className="card card-bordered">
          <div className="table-responsive">
            <table className="table table-hover mb-0 eod-table">
              <thead>
                <tr>
                  <th>Invoice No</th>
                  <th>Name</th>
                  <th>Phone Number</th>
                  <th>Services</th>
                  <th className="text-end">Service Cost</th>
                  <th>Products</th>
                  <th className="text-end">Products Cost</th>
                  <th>Date of Sales</th>
                  <th className="text-end">Sales Cost</th>
                  <th>Mode of Payment</th>
                  {canTrash && <th>Trash</th>}
                  <th>Created by</th>
                  <th>Edited by</th>
                  <th>Action</th>
                  <th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="fw-medium">{row.invoiceCode}</td>
                    <td>{row.customerName}</td>
                    <td>{row.customerPhone ?? "-"}</td>
                    <td>{row.services.join(", ") || "-"}</td>
                    <td className="text-end">{formatMoney(row.serviceCost)}</td>
                    <td>{row.products.join(", ") || "-"}</td>
                    <td className="text-end">{formatMoney(row.productCost)}</td>
                    <td>{formatDate(row.invoiceDate)}</td>
                    <td className="text-end fw-medium">{formatMoney(row.salesCost)}</td>
                    <td>
                      {row.paymentMethods.length
                        ? row.paymentMethods.map(methodLabel).join(", ")
                        : "Unpaid"}
                    </td>
                    {canTrash && (
                      <td>
                        <Button size="sm" color="danger" outline onClick={() => makeTrash(row)}>
                          <Icon name="trash" />
                          <span>Make Trash</span>
                        </Button>
                      </td>
                    )}
                    <td>{row.createdBy ?? "-"}</td>
                    <td>{row.editedBy ?? "-"}</td>
                    <td>
                      <Link to={`/billing/invoices/${row.id}`}>View Invoice</Link>
                    </td>
                    <td>{row.comment ?? "-"}</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={canTrash ? 15 : 14} className="text-center text-soft py-4">
                      No sales for this window
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PageShell>
  );
};

export default EodReport;
