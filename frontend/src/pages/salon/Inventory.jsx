/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Alert, Col, Form, FormGroup, Input, Label, Row, Spinner } from "reactstrap";
import { Button, Icon } from "@/components/Component";
import DataGrid from "@/components/salon/DataGrid";
import PageShell from "@/components/salon/PageShell";
import ReportExportButtons from "@/components/salon/ReportExportButtons";
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
import { LoaderOne } from "@/components/ui/loader";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import { formatDate, formatMoney, labelize, todayInputDate } from "@/utils/salonFormat";

const BASE = "/admin/inventory";
const MOVEMENT_TYPES = ["STOCK_IN", "RETAIL_SALE", "USED_IN_SERVICE", "STOCK_OUT", "DAMAGED", "ADJUSTMENT", "RETURNED"];
const STOCK_OUT_TYPES = ["STOCK_OUT", "USED_IN_SERVICE", "DAMAGED"];

const productLink = (p, suffix = "") => <Link to={`/admin/products/${p.id}${suffix}`} className="fw-medium">{p.name}</Link>;
const productOption = (p) => <option key={p.id} value={p.id}>{p.name} ({formatQty(p.currentStock)} {p.unit})</option>;

const Inventory = () => {
  const { tab: tabParam } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = canManageProducts(user?.role);
  const [products, setProducts] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const load = async () => {
    try {
      const [p, v] = await Promise.all([salonApi.products.list(), salonApi.vendors.list()]);
      setProducts(p.data || []);
      setVendors(v.data || []);
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
  const summary = useMemo(() => ({
    value: active.reduce((s, p) => s + Math.max(Number(p.currentStock), 0) * Number(p.costPrice), 0),
    low: attention.filter((p) => stockStatus(p).key === "low").length,
    out: attention.filter((p) => stockStatus(p).key === "out").length,
  }), [active, attention]);

  const tabs = [
    { key: "all", label: "All Stock" },
    { key: "low-stock", label: "Low Stock", badge: attention.length },
    { key: "activity", label: "Stock Activity" },
    ...(canManage ? [{ key: "receive", label: "Receive Stock" }, { key: "adjust", label: "Adjust Stock" }] : []),
  ];
  const tab = tabs.some((t) => t.key === tabParam) ? tabParam : "all";

  const reorder = (p) => navigate(`${BASE}/receive?productId=${p.id}&qty=${suggestedOrderQty(p)}`);
  const reorderColumn = {
    key: "reorder",
    label: "",
    render: (_, p) => canManage && stockStatus(p).key !== "in"
      ? <Button size="sm" color="primary" outline onClick={() => reorder(p)}>Reorder</Button>
      : null,
  };
  const q = search.trim().toLowerCase();
  const visible = active.filter((p) => !q || [p.name, p.sku, p.vendor?.name].some((v) => v?.toLowerCase().includes(q)));

  return (
    <PageShell
      title="Inventory"
      description="What stock needs your attention."
      tools={canManage && (
        <>
          <Button color="light" onClick={() => navigate(`${BASE}/adjust`)}><Icon name="exchange" /><span>Adjust Stock</span></Button>
          <Button color="primary" onClick={() => navigate(`${BASE}/receive`)}><Icon name="plus" /><span>Receive Stock</span></Button>
        </>
      )}
    >
      {error && <Alert color="danger">{error}</Alert>}
      <Row className="g-3 mb-4">
        <Col xs="6" lg="3"><KpiCard label="Inventory Value" value={formatMoney(summary.value)} /></Col>
        <Col xs="6" lg="3"><KpiCard label="Low Stock" value={summary.low} tone={summary.low ? "warning" : undefined} /></Col>
        <Col xs="6" lg="3"><KpiCard label="Out of Stock" value={summary.out} tone={summary.out ? "danger" : undefined} /></Col>
        <Col xs="6" lg="3"><KpiCard label="Reorder Needed" value={attention.length} tone={attention.length ? "primary" : undefined} /></Col>
      </Row>

      <RouteTabs base={BASE} tabs={tabs} active={tab} />

      {loading ? (
        <div className="d-flex justify-content-center py-5 text-primary"><LoaderOne label="Loading inventory" /></div>
      ) : (
        <>
          {tab === "all" && (
            <DataGrid
              rows={visible}
              emptyText="No active products."
              header={
                <div className="card-inner border-bottom">
                  <div className="form-control-wrap" style={{ maxWidth: 420 }}>
                    <div className="form-icon form-icon-left"><Icon name="search" /></div>
                    <Input placeholder="Search product, SKU or vendor..." value={search} onChange={(e) => setSearch(e.target.value)} />
                  </div>
                </div>
              }
              columns={[
                { key: "name", label: "Product", render: (_, p) => productLink(p) },
                { key: "currentStock", label: "Current", render: (v, p) => `${formatQty(v)} ${p.unit}` },
                { key: "lowStockAlert", label: "Min Stock", render: formatQty },
                { key: "value", label: "Value", render: (_, p) => formatMoney(Math.max(Number(p.currentStock), 0) * Number(p.costPrice)) },
                { key: "status", label: "Status", render: (_, p) => <StockBadge product={p} /> },
                { key: "lastPurchaseAt", label: "Last Purchase", render: (v) => (v ? formatDate(v) : "—") },
                { key: "vendor", label: "Vendor", render: (v) => v?.name || "—" },
                reorderColumn,
              ]}
            />
          )}

          {tab === "low-stock" && (
            <DataGrid
              rows={attention}
              emptyText="Nothing needs reordering. Nicely stocked."
              header={<div className="card-inner border-bottom d-flex justify-content-end"><ReportExportButtons reportType="low-stock" /></div>}
              columns={[
                { key: "name", label: "Product", render: (_, p) => productLink(p) },
                { key: "currentStock", label: "Stock", render: (v, p) => `${formatQty(v)} ${p.unit}` },
                { key: "lowStockAlert", label: "Minimum", render: formatQty },
                { key: "suggested", label: "Suggested Order", render: (_, p) => <strong>{formatQty(suggestedOrderQty(p))}</strong> },
                { key: "vendor", label: "Vendor", render: (v) => v?.name || <span className="text-soft">Not set</span> },
                { key: "status", label: "Status", render: (_, p) => <StockBadge product={p} /> },
                reorderColumn,
              ]}
            />
          )}

          {tab === "activity" && <StockActivity products={products} />}
          {tab === "receive" && canManage && (
            <ReceiveStock products={active} vendors={vendors.filter((v) => v.status)} onReceived={load} />
          )}
          {tab === "adjust" && canManage && <AdjustStock products={active} onAdjusted={load} />}
        </>
      )}
    </PageShell>
  );
};

const StockActivity = ({ products }) => {
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
          <div className="card-inner border-bottom">
            <Row className="g-2 align-items-end">
              <Col md="3"><Label>Product</Label><Input type="select" value={filters.productId} onChange={set("productId")}><option value="">All products</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Input></Col>
              <Col md="3"><Label>Activity</Label><Input type="select" value={filters.type} onChange={set("type")}><option value="">All activity</option>{MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{movementLabel({ type: t })}</option>)}</Input></Col>
              <Col xs="6" md="2"><Label>From</Label><Input type="date" value={filters.from} onChange={set("from")} /></Col>
              <Col xs="6" md="2"><Label>To</Label><Input type="date" value={filters.to} onChange={set("to")} /></Col>
              <Col md="2"><Button color="primary" outline onClick={load}>Apply</Button></Col>
            </Row>
          </div>
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
  const blankForm = { vendorId: "", invoiceNo: "", purchaseDate: todayInputDate(), taxAmount: "", paymentStatus: "UNPAID", paidAmount: "", paymentMethod: "CASH", note: "" };
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
  const [form, setForm] = useState(() => ({ productId: params.get("productId") || "", type: "ADJUSTMENT", quantity: "", reason: "" }));
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
      await salonApi.stockMovements.createManual({ salonId: product.salonId, productId: product.id, type: form.type, quantity: qty, reason: form.reason });
      setMessage(`${product.name}: stock updated to ${formatQty(Number(product.currentStock) + delta)} ${product.unit}.`);
      setForm({ productId: "", type: "ADJUSTMENT", quantity: "", reason: "" });
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
