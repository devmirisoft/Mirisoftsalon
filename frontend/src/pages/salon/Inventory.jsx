/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Alert, Col, Form, FormGroup, Input, Label, Row, Spinner } from "reactstrap";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { Button, Icon } from "@/components/Component";
import DataGrid from "@/components/salon/DataGrid";
import PageShell from "@/components/salon/PageShell";
import ReportExportButtons from "@/components/salon/ReportExportButtons";
import ServerPagination from "@/components/salon/ServerPagination";
import {
  ADJUST_TYPES,
  KpiCard,
  PAYMENT_METHODS,
  RouteTabs,
  StockBadge,
  canManageProducts,
  formatQty,
  movementDelta,
  movementLabel,
  stockStatus,
  suggestedOrderQty,
} from "@/components/salon/ProductForms";
import { LOCATIONS } from "@/components/salon/InventoryModals";
import { LoaderOne } from "@/components/ui/loader";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import { formatDate, formatMoney, labelize, todayInputDate } from "@/utils/salonFormat";

const BASE = "/admin/inventory";
const MOVEMENT_TYPES = ["STOCK_IN", "RETAIL_SALE", "USED_IN_SERVICE", "STOCK_OUT", "DAMAGED", "ADJUSTMENT", "RETURNED", "TRANSFER", "OPEN_CONTAINER", "WASTAGE", "LOST"];
const STOCK_OUT_TYPES = ["STOCK_OUT", "USED_IN_SERVICE", "DAMAGED", "WASTAGE", "LOST"];

Chart.register(ArcElement, BarElement, CategoryScale, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip);

// Status colours match the StockBadge theme colours (success / warning / danger).
const STATUS_SLICES = [
  { key: "in", label: "In Stock", color: "#1ee0ac" },
  { key: "low", label: "Low Stock", color: "#f4bd0e" },
  { key: "out", label: "Out of Stock", color: "#e85347" },
];
// Fixed order, checked with the dataviz palette validator (CVD + contrast, light and dark).
const CATEGORY_COLORS = ["#3b6fe0", "#db2777", "#8b5cf6", "#d97706", "#0f9d82"];
const OTHER_COLOR = "#8091a7";
const STOCK_IN_COLOR = "#16a34a";
const STOCK_OUT_COLOR = "#2563eb";
const DAYS = 30;

const TABS = [
  { key: "all", label: "All Stock" },
  { key: "low-stock", label: "Low Stock" },
  { key: "out-of-stock", label: "Out of Stock" },
  { key: "reorder", label: "Reorder Suggestions" },
  { key: "activity", label: "Stock Activity" },
];
// Forms are reached from the header buttons, not the tab bar.
const FORM_TABS = { receive: "Receive Stock", adjust: "Adjust Stock" };

const productLink = (p, suffix = "") => <Link to={`/admin/products/${p.id}${suffix}`} className="fw-medium">{p.name}</Link>;
const productOption = (p) => <option key={p.id} value={p.id}>{p.name} ({formatQty(p.currentStock)} {p.unit})</option>;
const stockValue = (p) => Math.max(Number(p.currentStock), 0) * Number(p.costPrice);
const compactMoney = (v) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: "compact", maximumFractionDigits: 1 }).format(v);
const dayKey = (d) => new Date(d).toDateString();

// Prints each bar's value above it.
const barValueLabels = {
  id: "barValueLabels",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const values = chart.data.datasets[0].data;
    ctx.save();
    ctx.font = `600 11px ${Chart.defaults.font.family}`;
    ctx.fillStyle = Chart.defaults.color;
    ctx.textAlign = "center";
    chart.getDatasetMeta(0).data.forEach((bar, i) => ctx.fillText(formatMoney(values[i]), bar.x, bar.y - 6));
    ctx.restore();
  },
};

const ChartCard = ({ title, children }) => (
  <div className="card card-bordered h-100">
    <div className="card-inner">
      <h6 className="title mb-3">{title}</h6>
      {children}
    </div>
  </div>
);

const Inventory = () => {
  const { tab: tabParam } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = canManageProducts(user?.role);
  const [products, setProducts] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ q: "", category: "", vendorId: "" });
  const [pager, setPager] = useState({ tab: "all", page: 1, limit: 10 });

  const load = async () => {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (DAYS - 1));
    try {
      const [p, v, m] = await Promise.all([
        salonApi.products.list(),
        salonApi.vendors.list(),
        // The chart is optional; a failure here shouldn't blank the page.
        salonApi.stockMovements.list({ from: since.toISOString() }).catch(() => ({ data: [] })),
      ]);
      setProducts(p.data || []);
      setVendors(v.data || []);
      setMovements(m.data || []);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const active = useMemo(() => products.filter((p) => p.status), [products]);
  const attention = useMemo(
    () => active.filter((p) => stockStatus(p).key !== "in")
      .sort((a, b) => Number(a.currentStock) - Number(b.currentStock)),
    [active]
  );
  const counts = useMemo(() => {
    const c = { in: 0, low: 0, out: 0 };
    active.forEach((p) => { c[stockStatus(p).key] += 1; });
    return c;
  }, [active]);
  const totalValue = useMemo(() => active.reduce((s, p) => s + stockValue(p), 0), [active]);
  const newProducts = useMemo(
    () => active.filter((p) => Date.now() - new Date(p.createdAt) < DAYS * 864e5).length,
    [active]
  );

  const byCategory = useMemo(() => {
    const totals = new Map();
    active.forEach((p) => {
      const key = p.category || "Uncategorized";
      totals.set(key, (totals.get(key) || 0) + stockValue(p));
    });
    const sorted = [...totals].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, CATEGORY_COLORS.length);
    const rest = sorted.slice(CATEGORY_COLORS.length).reduce((s, [, v]) => s + v, 0);
    return rest > 0 ? [...top, ["Other", rest]] : top;
  }, [active]);

  // ponytail: valued at today's cost price, not the price on the day it moved.
  const movementSeries = useMemo(() => {
    const days = [...Array(DAYS)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (DAYS - 1 - i));
      return { key: dayKey(d), label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }), in: 0, out: 0 };
    });
    const index = new Map(days.map((d) => [d.key, d]));
    movements.forEach((m) => {
      const day = index.get(dayKey(m.createdAt));
      const delta = movementDelta(m);
      if (!day || !delta) return;
      day[delta > 0 ? "in" : "out"] += Math.abs(delta) * Number(m.product?.costPrice || 0);
    });
    return days;
  }, [movements]);

  const categories = useMemo(() => [...new Set(active.map((p) => p.category).filter(Boolean))].sort(), [active]);

  const formTab = canManage && FORM_TABS[tabParam] ? tabParam : null;
  const tab = formTab || (TABS.some((t) => t.key === tabParam) ? tabParam : "all");

  const q = filters.q.trim().toLowerCase();
  const filtered = active.filter((p) =>
    (!q || [p.name, p.sku, p.barcode, p.brand?.name, p.vendor?.name].some((v) => v?.toLowerCase().includes(q))) &&
    (!filters.category || p.category === filters.category) &&
    (!filters.vendorId || p.vendorId === filters.vendorId)
  );
  const rows = {
    all: filtered,
    "low-stock": filtered.filter((p) => stockStatus(p).key === "low"),
    "out-of-stock": filtered.filter((p) => stockStatus(p).key === "out"),
    reorder: attention.filter((p) => filtered.includes(p)),
  }[tab] || [];

  // Page resets when the tab or a filter changes.
  const limit = pager.limit;
  const totalPages = Math.max(1, Math.ceil(rows.length / limit));
  const page = pager.tab === tab ? Math.min(pager.page, totalPages) : 1;
  const pageRows = rows.slice((page - 1) * limit, page * limit);
  const setPage = (next) => setPager((p) => ({ ...p, tab, page: next }));
  const setFilter = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };

  const reorder = (p) => navigate(`${BASE}/receive?productId=${p.id}&qty=${suggestedOrderQty(p)}`);
  const rowActions = (p) => (
    <>
      <Button onClick={() => navigate(`/admin/products/${p.id}`)}><Icon name="eye" />View Product</Button>
      <Button onClick={() => navigate(`/admin/products/${p.id}/stock`)}><Icon name="histroy" />Stock History</Button>
      {canManage && <Button onClick={() => navigate(`${BASE}/adjust?productId=${p.id}`)}><Icon name="exchange" />Adjust Stock</Button>}
      {canManage && <Button onClick={() => reorder(p)}><Icon name="cart" />Reorder</Button>}
    </>
  );

  const toolbar = (controls) => (
    <div className="inv-toolbar card-inner border-bottom">
      <RouteTabs base={BASE} tabs={TABS} active={tab} />
      {controls && <div className="inv-filters">{controls}</div>}
    </div>
  );
  const productFilters = (
    <>
      <div className="form-control-wrap" style={{ width: 260 }}>
        <div className="form-icon form-icon-left"><Icon name="search" /></div>
        <Input placeholder="Search product, SKU or barcode..." value={filters.q} onChange={setFilter("q")} />
      </div>
      <Input type="select" style={{ width: 170 }} value={filters.category} onChange={setFilter("category")}>
        <option value="">All Categories</option>
        {categories.map((c) => <option key={c}>{c}</option>)}
      </Input>
      <Input type="select" style={{ width: 170 }} value={filters.vendorId} onChange={setFilter("vendorId")}>
        <option value="">All Vendors</option>
        {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </Input>
      {tab === "reorder" && <ReportExportButtons reportType="low-stock" />}
    </>
  );
  const pagination = (
    <div className="px-4 pb-3">
      <ServerPagination
        pagination={{ page, totalPages, total: rows.length, limit }}
        onPage={setPage}
        onLimit={(next) => setPager({ tab, page: 1, limit: next })}
      />
    </div>
  );

  const stockColumns = [
    { key: "name", label: "Product", render: (_, p) => productLink(p) },
    { key: "sku", label: "SKU", render: (v) => <span className="text-soft">{v || "—"}</span> },
    { key: "category", label: "Category", render: (v) => v || "—" },
    { key: "brand", label: "Brand", render: (v) => v?.name || "—" },
    { key: "currentStock", label: "Current Stock", render: (v, p) => `${formatQty(v)} ${p.unit}` },
    { key: "lowStockAlert", label: "Min Stock", render: formatQty },
    { key: "status", label: "Status", render: (_, p) => <StockBadge product={p} /> },
    { key: "lastPurchaseAt", label: "Last Purchase", render: (v) => (v ? formatDate(v) : "—") },
    { key: "vendor", label: "Vendor", render: (v) => v?.name || "—" },
    { key: "value", label: "Inventory Value", render: (_, p) => formatMoney(stockValue(p)) },
  ];
  const reorderColumns = [
    { key: "name", label: "Product", render: (_, p) => productLink(p) },
    { key: "currentStock", label: "Stock", render: (v, p) => `${formatQty(v)} ${p.unit}` },
    { key: "lowStockAlert", label: "Minimum", render: formatQty },
    { key: "suggested", label: "Suggested Order", render: (_, p) => <strong>{formatQty(suggestedOrderQty(p))}</strong> },
    { key: "vendor", label: "Vendor", render: (v) => v?.name || <span className="text-soft">Not set</span> },
    { key: "status", label: "Status", render: (_, p) => <StockBadge product={p} /> },
    {
      key: "reorder",
      label: "",
      render: (_, p) => canManage && <Button size="sm" color="primary" outline onClick={() => reorder(p)}>Reorder</Button>,
    },
  ];

  const total = active.length;
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

  return (
    <PageShell
      className="inventory-page"
      title="Inventory"
      description="Track stock, monitor levels and manage purchases"
      tools={canManage && (
        <>
          <Button color="light" onClick={() => navigate(`${BASE}/adjust`)}><Icon name="exchange" /><span>Adjust Stock</span></Button>
          <Button color="primary" outline onClick={() => navigate(`${BASE}/receive`)}><Icon name="package" /><span>Receive Stock</span></Button>
          <Button color="primary" onClick={() => navigate(`${BASE}/receive`)}><Icon name="plus" /><span>New Purchase</span></Button>
        </>
      )}
    >
      {error && <Alert color="danger">{error}</Alert>}

      {loading ? (
        <div className="d-flex justify-content-center py-5 text-primary"><LoaderOne label="Loading inventory" /></div>
      ) : formTab ? (
        <>
          <div className="d-flex align-items-center gap-2 mb-3">
            <Link to={BASE} className="btn btn-icon btn-trigger" title="Back to stock"><Icon name="arrow-left" /></Link>
            <h5 className="mb-0">{FORM_TABS[formTab]}</h5>
          </div>
          {formTab === "receive" && (
            <ReceiveStock products={active} vendors={vendors.filter((v) => v.status)} onReceived={load} />
          )}
          {formTab === "adjust" && <AdjustStock products={active} onAdjusted={load} />}
        </>
      ) : (
        <>
          <Row className="g-3 mb-3">
            <Col xs="6" md="4" xl>
              <KpiCard icon="coins" iconColor="purple" label="Inventory Value" value={formatMoney(totalValue)} hint="At cost price" />
            </Col>
            <Col xs="6" md="4" xl>
              <KpiCard
                icon="package"
                iconColor="info"
                label="Total Products"
                value={total}
                hint={newProducts > 0 ? <span className="text-success"><Icon name="arrow-up" /> +{newProducts} new products</span> : "Active products"}
              />
            </Col>
            <Col xs="6" md="4" xl><KpiCard icon="alert" iconColor="warning" label="Low Stock" value={counts.low} hint="Needs attention" /></Col>
            <Col xs="6" md="6" xl><KpiCard icon="cross-circle" iconColor="danger" label="Out of Stock" value={counts.out} hint="Reorder required" /></Col>
            <Col xs="12" md="6" xl><KpiCard icon="cart" iconColor="success" label="Reorder Needed" value={attention.length} hint="Suggested purchase" /></Col>
          </Row>

          <Row className="g-3 mb-3">
            <Col md="6" xl="4">
              <ChartCard title="Stock Status">
                <div className="d-flex flex-wrap align-items-center justify-content-center gap-4">
                  <div className="position-relative" style={{ width: 160, height: 160 }}>
                    <Doughnut
                      data={{
                        labels: STATUS_SLICES.map((s) => s.label),
                        datasets: [{
                          data: STATUS_SLICES.map((s) => counts[s.key]),
                          backgroundColor: STATUS_SLICES.map((s) => s.color),
                          borderWidth: 2,
                        }],
                      }}
                      options={{ cutout: "72%", maintainAspectRatio: false, plugins: { legend: { display: false } } }}
                    />
                    <div className="position-absolute top-50 start-50 translate-middle text-center">
                      <div className="fs-3 fw-bold lh-1">{total}</div>
                      <div className="small text-soft">Products</div>
                    </div>
                  </div>
                  <ul className="list-unstyled mb-0 flex-grow-1" style={{ minWidth: 170, maxWidth: 240 }}>
                    {STATUS_SLICES.map((s) => (
                      <li key={s.key} className="d-flex align-items-center gap-2 py-1">
                        <span className="rounded-circle flex-shrink-0" style={{ width: 10, height: 10, background: s.color }} />
                        <span className="flex-grow-1">{s.label}</span>
                        <span className="fw-medium">{counts[s.key]} ({pct(counts[s.key])}%)</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </ChartCard>
            </Col>
            <Col md="6" xl="4">
              <ChartCard title="Inventory Value by Category">
                <div style={{ height: 200 }}>
                  <Bar
                    plugins={[barValueLabels]}
                    data={{
                      labels: byCategory.map(([name]) => name),
                      datasets: [{
                        data: byCategory.map(([, value]) => value),
                        backgroundColor: byCategory.map(([name], i) => (name === "Other" ? OTHER_COLOR : CATEGORY_COLORS[i])),
                        borderRadius: 4,
                        maxBarThickness: 44,
                      }],
                    }}
                    options={{
                      maintainAspectRatio: false,
                      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => formatMoney(item.raw) } } },
                      scales: {
                        x: { grid: { display: false } },
                        y: { beginAtZero: true, grace: "15%", border: { display: false }, ticks: { callback: compactMoney, maxTicksLimit: 5 } },
                      },
                    }}
                  />
                </div>
              </ChartCard>
            </Col>
            <Col xl="4">
              <ChartCard title={`Stock Movement (Last ${DAYS} Days)`}>
                <div style={{ height: 200 }}>
                  <Line
                    data={{
                      labels: movementSeries.map((d) => d.label),
                      datasets: [
                        { label: "Stock In", data: movementSeries.map((d) => d.in), borderColor: STOCK_IN_COLOR, backgroundColor: `${STOCK_IN_COLOR}22` },
                        { label: "Stock Out", data: movementSeries.map((d) => d.out), borderColor: STOCK_OUT_COLOR, backgroundColor: `${STOCK_OUT_COLOR}22` },
                      ].map((ds) => ({ ...ds, fill: true, tension: 0.4, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4 })),
                    }}
                    options={{
                      maintainAspectRatio: false,
                      interaction: { mode: "index", intersect: false },
                      plugins: {
                        legend: { position: "top", align: "end", labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 8, boxHeight: 8 } },
                        tooltip: { callbacks: { label: (item) => `${item.dataset.label}: ${formatMoney(item.raw)}` } },
                      },
                      scales: {
                        x: { grid: { display: false }, ticks: { maxTicksLimit: 5, maxRotation: 0 } },
                        y: { beginAtZero: true, border: { display: false }, ticks: { callback: compactMoney, maxTicksLimit: 5 } },
                      },
                    }}
                  />
                </div>
              </ChartCard>
            </Col>
          </Row>

          {tab === "activity" ? (
            <StockActivity products={products} toolbar={toolbar()} />
          ) : (
            <DataGrid
              rows={pageRows}
              emptyText={
                tab === "reorder" ? "Nothing needs reordering. Nicely stocked."
                  : filtered.length < active.length ? "No products match these filters."
                  : "No products here."
              }
              header={toolbar(productFilters)}
              footer={pagination}
              columns={tab === "reorder" ? reorderColumns : stockColumns}
              renderActions={tab === "reorder" ? undefined : rowActions}
            />
          )}
        </>
      )}
    </PageShell>
  );
};

const StockActivity = ({ products, toolbar }) => {
  const [filters, setFilters] = useState({ productId: "", type: "", from: "", to: "" });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const query = {
        ...filters,
        ...(filters.to ? { to: `${filters.to}T23:59:59.999Z` } : {}),
      };
      setRows((await salonApi.stockMovements.list(query)).data || []);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };
  // Filters apply when the user clicks Apply.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const set = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));

  return (
    <>
      {error && <Alert color="danger">{error}</Alert>}
      <DataGrid
        loading={loading}
        rows={rows}
        emptyText="No stock activity for these filters."
        header={
          <>
          {toolbar}
          <div className="card-inner border-bottom">
            <Row className="g-2 align-items-end">
              <Col md="3"><Label>Product</Label><Input type="select" value={filters.productId} onChange={set("productId")}><option value="">All products</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Input></Col>
              <Col md="3"><Label>Activity</Label><Input type="select" value={filters.type} onChange={set("type")}><option value="">All activity</option>{MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{movementLabel({ type: t })}</option>)}</Input></Col>
              <Col xs="6" md="2"><Label>From</Label><Input type="date" value={filters.from} onChange={set("from")} /></Col>
              <Col xs="6" md="2"><Label>To</Label><Input type="date" value={filters.to} onChange={set("to")} /></Col>
              <Col md="2"><Button color="primary" outline onClick={load}>Apply</Button></Col>
            </Row>
          </div>
          </>
        }
        columns={[
          { key: "createdAt", label: "Date", render: (v) => formatDate(v, true) },
          { key: "product", label: "Product", render: (v) => (v ? productLink(v, "/stock") : "—") },
          { key: "type", label: "Activity", render: (_, m) => <>{movementLabel(m)}{m.reason && m.reason !== "Opening stock" && <div className="small text-soft">{m.reason}</div>}</> },
          { key: "referenceType", label: "Reference", render: (v) => (v ? labelize(v) : "—") },
          { key: "in", label: "Stock In", render: (_, m) => (movementDelta(m) > 0 ? <span className="text-success">+{formatQty(movementDelta(m))}</span> : "—") },
          { key: "out", label: "Stock Out", render: (_, m) => (movementDelta(m) < 0 ? <span className="text-danger">{formatQty(-movementDelta(m))}</span> : "—") },
          { key: "stockAfter", label: "Balance", render: formatQty },
          { key: "createdBy", label: "By", render: (v) => v?.name || "System" },
        ]}
      />
    </>
  );
};

const emptyLine = () => ({ productId: "", quantity: 1, unitCost: 0 });

/** One form: purchase record + stock in + cost update + vendor balance (+ payment if paid). */
const ReceiveStock = ({ products, vendors, onReceived }) => {
  const [params, setParams] = useSearchParams();
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const prefill = byId.get(params.get("productId"));
  const blankForm = { vendorId: "", invoiceNo: "", purchaseDate: todayInputDate(), location: "WAREHOUSE", taxAmount: "", paymentStatus: "UNPAID", paidAmount: "", paymentMethod: "CASH", note: "" };
  const [form, setForm] = useState(() => ({ ...blankForm, vendorId: params.get("vendorId") || prefill?.vendorId || "" }));
  const [lines, setLines] = useState(() => [
    prefill ? { productId: prefill.id, quantity: Number(params.get("qty")) || 1, unitCost: Number(prefill.costPrice) } : emptyLine(),
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState({ rows: [], loading: true });

  const loadHistory = () =>
    salonApi.productPurchases.list()
      .then((r) => setHistory({ rows: (r.data || []).slice(0, 10), loading: false }))
      .catch(() => setHistory({ rows: [], loading: false }));
  useEffect(() => { loadHistory(); }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const updateLine = (i, patch) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const selectProduct = (i, productId) => updateLine(i, { productId, unitCost: Number(byId.get(productId)?.costPrice) || 0 });

  const subtotal = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitCost || 0), 0);
  const tax = Number(form.taxAmount || 0);
  const total = subtotal + tax;
  const paid = form.paymentStatus === "PAID" ? total : form.paymentStatus === "PARTIAL" ? Number(form.paidAmount || 0) : 0;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    if (lines.some((l) => !l.productId || Number(l.quantity) <= 0)) return setError("Pick a product and a quantity above 0 on every line.");
    if (new Set(lines.map((l) => l.productId)).size !== lines.length) return setError("Each product can appear only once — combine the quantities.");
    if (paid > 0 && !form.vendorId) return setError("Select the vendor to record a payment.");
    if (form.paymentStatus === "PARTIAL" && !(paid > 0 && paid < total)) return setError("Partial payment must be more than 0 and less than the total.");
    setSaving(true);
    try {
      const { data } = await salonApi.productPurchases.create({
        salonId: byId.get(lines[0].productId)?.salonId,
        ...(form.vendorId ? { vendorId: form.vendorId } : {}),
        ...(form.invoiceNo ? { invoiceNo: form.invoiceNo } : {}),
        ...(form.note ? { note: form.note } : {}),
        purchaseDate: form.purchaseDate,
        location: form.location,
        taxAmount: tax,
        paidAmount: paid,
        ...(paid > 0 ? { paymentMethod: form.paymentMethod } : {}),
        items: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) })),
      });
      setMessage(`Stock received — ${data?.purchaseCode || "purchase saved"}. ${lines.length} product${lines.length > 1 ? "s" : ""} updated.`);
      setForm(blankForm);
      setLines([emptyLine()]);
      setParams({}, { replace: true });
      await Promise.all([onReceived(), loadHistory()]);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {error && <Alert color="danger">{error}</Alert>}
      {message && <Alert color="success">{message}</Alert>}
      <div className="card card-bordered mb-4">
        <div className="card-inner">
          <Form onSubmit={submit}>
            <Row className="g-3">
              <Col md="4"><FormGroup><Label>Vendor</Label>
                <Input type="select" value={form.vendorId} onChange={set("vendorId")}>
                  <option value="">Select vendor</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </Input></FormGroup></Col>
              <Col md="4"><FormGroup><Label>Invoice Number</Label><Input value={form.invoiceNo} onChange={set("invoiceNo")} placeholder="Vendor bill no." /></FormGroup></Col>
              <Col md="4"><FormGroup><Label>Purchase Date</Label><Input type="date" value={form.purchaseDate} onChange={set("purchaseDate")} /></FormGroup></Col>
              <Col md="4"><FormGroup><Label>Receive Into</Label>
                <Input type="select" value={form.location} onChange={set("location")}>{LOCATIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</Input></FormGroup></Col>
            </Row>

            <div className="table-responsive mt-2">
              <table className="table">
                <thead><tr><th>Product</th><th style={{ width: 130 }}>Qty</th><th style={{ width: 150 }}>Rate (₹)</th><th style={{ width: 140 }} className="text-end">Amount</th><th style={{ width: 50 }} /></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td><Input type="select" value={l.productId} onChange={(e) => selectProduct(i, e.target.value)}><option value="">Select product</option>{products.map(productOption)}</Input></td>
                      <td><Input type="number" min="0.01" step="0.01" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} /></td>
                      <td><Input type="number" min="0" step="0.01" value={l.unitCost} onChange={(e) => updateLine(i, { unitCost: e.target.value })} /></td>
                      <td className="text-end">{formatMoney(Number(l.quantity || 0) * Number(l.unitCost || 0))}</td>
                      <td><Button type="button" color="danger" size="sm" outline disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}><Icon name="trash" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button type="button" color="light" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}><Icon name="plus" /> Add Product</Button>

            <Row className="g-3 mt-2 justify-content-between">
              <Col md="5">
                <FormGroup><Label>Payment Status</Label>
                  <div className="d-flex gap-3">
                    {[["PAID", "Paid"], ["PARTIAL", "Partial"], ["UNPAID", "Unpaid"]].map(([value, label]) => (
                      <FormGroup check key={value}>
                        <Input type="radio" id={`pay-${value}`} name="paymentStatus" checked={form.paymentStatus === value} onChange={() => setForm((f) => ({ ...f, paymentStatus: value }))} />
                        <Label check for={`pay-${value}`}>{label}</Label>
                      </FormGroup>
                    ))}
                  </div>
                </FormGroup>
                {form.paymentStatus !== "UNPAID" && (
                  <Row className="g-2">
                    {form.paymentStatus === "PARTIAL" && (
                      <Col xs="6"><Label>Amount Paid (₹)</Label><Input type="number" min="0" step="0.01" value={form.paidAmount} onChange={set("paidAmount")} /></Col>
                    )}
                    <Col xs="6"><Label>Payment Mode</Label>
                      <Input type="select" value={form.paymentMethod} onChange={set("paymentMethod")}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{labelize(m)}</option>)}</Input></Col>
                  </Row>
                )}
                <FormGroup className="mt-3"><Label>Note</Label><Input value={form.note} onChange={set("note")} /></FormGroup>
              </Col>
              <Col md="4">
                <table className="table table-sm mb-3">
                  <tbody>
                    <tr><td>Subtotal</td><td className="text-end">{formatMoney(subtotal)}</td></tr>
                    <tr><td className="align-middle">Tax (₹)</td><td><Input bsSize="sm" className="text-end" type="number" min="0" step="0.01" value={form.taxAmount} onChange={set("taxAmount")} /></td></tr>
                    <tr className="fw-bold"><td>Total</td><td className="text-end">{formatMoney(total)}</td></tr>
                    {paid > 0 && <tr className="text-soft"><td>Balance due</td><td className="text-end">{formatMoney(total - paid)}</td></tr>}
                  </tbody>
                </table>
                <Button type="submit" color="primary" className="w-100 justify-content-center" disabled={saving}>
                  {saving && <Spinner size="sm" className="me-1" />}Receive Stock
                </Button>
              </Col>
            </Row>
          </Form>
        </div>
      </div>

      <h6 className="mb-3">Recent receipts</h6>
      <DataGrid
        loading={history.loading}
        rows={history.rows}
        emptyText="No stock received yet."
        columns={[
          { key: "purchaseCode", label: "Purchase #", render: (v, r) => <>{v}{r.invoiceNo && <div className="small text-soft">Inv: {r.invoiceNo}</div>}</> },
          { key: "purchaseDate", label: "Date", render: (v) => formatDate(v) },
          { key: "vendor", label: "Vendor", render: (v, r) => (v ? <Link to={`/admin/vendors/${v.id}`}>{v.name}</Link> : r.supplierName || "—") },
          { key: "items", label: "Products", render: (v) => v?.map((i) => i.product?.name).join(", ") },
          { key: "totalAmount", label: "Total", render: formatMoney },
          { key: "balanceAmount", label: "Due", render: formatMoney },
          { key: "paymentStatus", label: "Payment", render: labelize },
        ]}
      />
    </>
  );
};

const AdjustStock = ({ products, onAdjusted }) => {
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState(() => ({ productId: params.get("productId") || "", type: "ADJUSTMENT", location: "WAREHOUSE", quantity: "", reason: "" }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const product = products.find((p) => p.id === form.productId);
  const qty = Number(form.quantity || 0);
  const delta = STOCK_OUT_TYPES.includes(form.type) ? -Math.abs(qty) : form.type === "ADJUSTMENT" ? qty : Math.abs(qty);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!product) return setError("Select a product.");
    if (!qty || (form.type !== "ADJUSTMENT" && qty < 0)) return setError("Enter a quantity. Only count corrections can be negative.");
    if (!form.reason.trim()) return setError("Give a reason so the history makes sense later.");
    setSaving(true);
    try {
      await salonApi.stockMovements.createManual({ salonId: product.salonId, productId: product.id, type: form.type, location: form.location, quantity: qty, reason: form.reason });
      setMessage(`${product.name}: stock updated to ${formatQty(Number(product.currentStock) + delta)} ${product.unit}.`);
      setForm({ productId: "", type: "ADJUSTMENT", location: "WAREHOUSE", quantity: "", reason: "" });
      setParams({}, { replace: true });
      await onAdjusted();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card card-bordered" style={{ maxWidth: 720 }}>
      <div className="card-inner">
        {error && <Alert color="danger">{error}</Alert>}
        {message && <Alert color="success">{message}</Alert>}
        <Form onSubmit={submit}>
          <Row className="g-3">
            <Col xs="12"><FormGroup><Label>Product</Label>
              <Input type="select" value={form.productId} onChange={set("productId")}><option value="">Select product</option>{products.map(productOption)}</Input></FormGroup></Col>
            <Col md="6"><FormGroup><Label>What happened?</Label>
              <Input type="select" value={form.type} onChange={set("type")}>{ADJUST_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Input></FormGroup></Col>
            <Col md="6"><FormGroup><Label>Quantity</Label>
              <Input type="number" step="0.01" value={form.quantity} onChange={set("quantity")} placeholder={form.type === "ADJUSTMENT" ? "e.g. -2 or 3" : "e.g. 2"} /></FormGroup></Col>
            <Col md="6"><FormGroup><Label>Location</Label>
              <Input type="select" value={form.location} onChange={set("location")}>{LOCATIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</Input></FormGroup></Col>
            <Col xs="12"><FormGroup><Label>Reason</Label><Input value={form.reason} onChange={set("reason")} placeholder="e.g. Monthly stock count, bottle broken" /></FormGroup></Col>
          </Row>
          <div className="d-flex justify-content-between align-items-center mt-3">
            <span className="text-soft">
              {product && <>Stock: <strong>{formatQty(product.currentStock)}</strong> → <strong>{formatQty(Number(product.currentStock) + delta)}</strong> {product.unit}</>}
            </span>
            <Button type="submit" color="primary" disabled={saving}>{saving && <Spinner size="sm" className="me-1" />}Update Stock</Button>
          </div>
        </Form>
      </div>
    </div>
  );
};

export default Inventory;
