/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import { Alert, Input, Spinner } from "reactstrap";
import { Icon, RSelect } from "@/components/Component";
import Head from "@/layout/head/Head";
import Content from "@/layout/content/Content";
import DataGrid from "@/components/salon/DataGrid";
import { TransferStockModal } from "@/components/salon/InventoryModals";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import { formatDate, formatMoney } from "@/utils/salonFormat";

const PAYMENT_METHODS = ["CASH", "UPI", "GPAY", "PAYTM", "PHONEPE", "CARD", "BANK_TRANSFER", "CHEQUE", "OTHER"];
const TAX_OPTIONS = [
  { value: 0, label: "No tax" },
  { value: 5, label: "GST 5%" },
  { value: 12, label: "GST 12%" },
  { value: 18, label: "GST 18%" },
  { value: 28, label: "GST 28%" },
];
const DATE_RANGES = [
  { value: "", label: "All dates" },
  { value: "0", label: "Today" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
];
const NOTE_LIMIT = 500;

const emptyLine = () => ({ productId: "", quantity: 1, price: 0 });
const round2 = (value) => Math.round(value * 100) / 100;
const lower = (...parts) => parts.filter(Boolean).join(" ").toLowerCase();
const matches = (option, input) => option.data.search.includes(input.toLowerCase());

// Rich row in the open menu, plain label once picked.
const richLabel = (option, { context }) =>
  context === "menu" ? (
    <div className="retail-opt">
      <span className="retail-opt-icon"><Icon name={option.icon} /></span>
      <span className="retail-opt-text">
        <strong>{option.label}</strong>
        {option.sub && <small>{option.sub}</small>}
      </span>
    </div>
  ) : option.label;

const Field = ({ icon, label, hint, children }) => (
  <div className="retail-tile">
    <div className="retail-label"><Icon name={icon} />{label}{hint && <span>{hint}</span>}</div>
    {children}
  </div>
);

const RetailProducts = () => {
  const { user } = useAuth();
  const [refs, setRefs] = useState({ products: [], branches: [], customers: [], salons: [] });
  const [history, setHistory] = useState([]);
  const [form, setForm] = useState({
    salonId: "",
    branchId: "",
    customerId: "",
    paymentMethod: "CASH",
    discountPercent: 0,
    taxPercent: 0,
    note: "",
  });
  const [items, setItems] = useState([emptyLine()]);
  const [filter, setFilter] = useState({ range: "", search: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  // The retail shelf ran short: what a warehouse transfer could cover.
  const [shortage, setShortage] = useState(null);
  const [transferring, setTransferring] = useState(false);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const load = async () => {
    setLoading(true);
    const [products, branches, customers, salons, records] = await Promise.allSettled([
      salonApi.products.list({ retail: true, status: true }),
      user?.role === "STAFF" ? Promise.resolve({ data: [] }) : salonApi.branches.list(),
      salonApi.customers.list(),
      user?.role === "SUPER_ADMIN" ? salonApi.salons.list() : Promise.resolve({ data: [] }),
      salonApi.retailSales.list(),
    ]);
    const data = (result) => (result.status === "fulfilled" ? result.value.data || [] : []);
    setRefs({ products: data(products), branches: data(branches), customers: data(customers), salons: data(salons) });
    setHistory(data(records));
    setLoading(false);
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const customerOptions = useMemo(() => [
    { value: "", label: "Walk-in customer", sub: "Guest", icon: "user-circle", search: "walk-in guest" },
    ...refs.customers.map((c) => ({
      value: c.id,
      label: c.name,
      sub: c.phone || c.email || c.customerCode,
      icon: "user",
      search: lower(c.name, c.phone, c.email, c.customerCode),
    })),
  ], [refs.customers]);

  // Products tied to another branch are rejected by the API, so hide them.
  const productOptions = useMemo(() => refs.products
    .filter((p) => !form.branchId || !p.branchId || p.branchId === form.branchId)
    .map((p) => ({
      value: p.id,
      label: p.name,
      sub: [p.sku, p.category, `${Number(p.currentStock)} ${p.unit} in stock (all locations)`].filter(Boolean).join(" · "),
      icon: "package",
      search: lower(p.name, p.sku, p.barcode, p.category),
      product: p,
    })), [refs.products, form.branchId]);

  const selectedCustomer = refs.customers.find((c) => c.id === form.customerId);
  // Blank lines are not submitted, so they must not count toward the discount base.
  const subtotal = items.reduce((sum, item) => sum + (item.productId ? Number(item.quantity || 0) * Number(item.price || 0) : 0), 0);
  const unitCount = items.reduce((sum, item) => sum + (item.productId ? Number(item.quantity || 0) : 0), 0);
  const discountPercent = Math.min(Math.max(Number(form.discountPercent) || 0, 0), 100);
  const manualDiscount = round2(subtotal * discountPercent / 100);
  const taxable = subtotal - manualDiscount;
  const taxAmount = taxable * Number(form.taxPercent || 0) / 100;
  const total = taxable + taxAmount;

  const updateLine = (index, patch) =>
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const priceOf = (productId) => Number(refs.products.find((p) => p.id === productId)?.sellingPrice) || 0;

  // The API allows each product once per sale, so a repeat add bumps the quantity.
  const quickAdd = (option) => {
    if (!option) return;
    setItems((current) => {
      const existing = current.findIndex((item) => item.productId === option.value);
      if (existing >= 0) {
        return current.map((item, i) => (i === existing ? { ...item, quantity: Number(item.quantity || 0) + 1 } : item));
      }
      const line = { productId: option.value, quantity: 1, price: priceOf(option.value) };
      const blank = current.findIndex((item) => !item.productId);
      return blank >= 0 ? current.map((item, i) => (i === blank ? line : item)) : [...current, line];
    });
  };

  const offerTransfer = async (stock) => {
    try {
      const { data } = await salonApi.inventory.product(stock.productId);
      const site =
        data.sites.find((row) => (row.branchId || null) === (stock.branchId || null)) ||
        { branchId: stock.branchId || null, WAREHOUSE: 0, RETAIL: stock.available, SERVICE: 0 };
      const salonWarehouse = site.branchId
        ? Number(data.sites.find((row) => !row.branchId)?.WAREHOUSE || 0)
        : 0;
      if (Number(site.WAREHOUSE) + salonWarehouse <= 0) return;
      setShortage({
        product: data.product,
        site,
        salonWarehouse,
        staff: data.staff,
        needed: Math.max(stock.needed - stock.available, 1),
      });
    } catch {
      // No transfer offer; the error above still explains the shortfall.
    }
  };

  const submit = async (event) => {
    event?.preventDefault();
    setError("");
    setMessage("");
    setShortage(null);
    const lines = items.filter((item) => item.productId);
    if (!lines.length || lines.some((item) => Number(item.quantity) <= 0)) {
      setError("Add at least one product with a positive quantity.");
      return;
    }
    setSaving(true);
    try {
      await salonApi.retailSales.create({
        ...(form.salonId ? { salonId: form.salonId } : {}),
        ...(form.branchId ? { branchId: form.branchId } : {}),
        ...(form.customerId ? { customerId: form.customerId } : {}),
        ...(form.note.trim() ? { note: form.note } : {}),
        paymentMethod: form.paymentMethod,
        discountAmount: manualDiscount,
        taxPercent: Number(form.taxPercent || 0),
        items: lines.map((item) => ({
          productId: item.productId,
          quantity: Number(item.quantity),
          unitPrice: Number(item.price),
        })),
      });
      setMessage("Retail sale saved and stock decreased.");
      setItems([emptyLine()]);
      setForm((current) => ({ ...current, customerId: "", discountPercent: 0, note: "" }));
      await load();
    } catch (saveError) {
      setError(saveError.message);
      if (saveError.code === "INSUFFICIENT_STOCK" && saveError.stock?.location === "RETAIL") {
        await offerTransfer(saveError.stock);
      }
    } finally {
      setSaving(false);
    }
  };

  const visibleHistory = useMemo(() => {
    const term = filter.search.trim().toLowerCase();
    const since = filter.range && new Date().setHours(0, 0, 0, 0) - Number(filter.range) * 86400000;
    return history.filter((sale) =>
      (!since || new Date(sale.saleDate) >= since) &&
      (!term || lower(sale.saleCode, sale.customer?.name, sale.customer?.phone, ...(sale.items || []).map((i) => i.product?.name)).includes(term))
    );
  }, [history, filter]);

  return (
    <>
      <Head title="Retail Sale" />
      <Content className="retail-page">
        <div className="retail-head">
          <span className="retail-head-icon"><Icon name="cart" /></span>
          <div className="flex-grow-1">
            <h3>Retail Sale</h3>
            <p>Sell retail products to customers and reduce stock.</p>
          </div>
          <span className="retail-chip"><Icon name="user" />{selectedCustomer?.name || "Walk-in customer"}</span>
        </div>

        {error && (
          <Alert color="danger" className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
            <span>{error}</span>
            {shortage && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setTransferring(true)}>
                Transfer from Warehouse
              </button>
            )}
          </Alert>
        )}
        <TransferStockModal
          isOpen={transferring}
          toggle={() => setTransferring(false)}
          product={shortage?.product}
          branchId={shortage?.site.branchId}
          stock={shortage?.site}
          salonWarehouse={shortage?.salonWarehouse}
          staff={shortage?.staff}
          from={Number(shortage?.site.WAREHOUSE || 0) > 0 ? "WAREHOUSE" : "SALON:WAREHOUSE"}
          toLocation="RETAIL"
          quantity={shortage?.needed || 1}
          submitLabel="Transfer & Continue"
          onSaved={() => {
            setTransferring(false);
            submit();
          }}
        />
        {message && <Alert color="success">{message}</Alert>}

        <form className="retail-board" onSubmit={submit}>
          <div className="retail-main">
            <div className="retail-fields">
              {user?.role === "SUPER_ADMIN" && (
                <Field icon="home-alt" label="Salon">
                  <Input type="select" required value={form.salonId} onChange={set("salonId")}>
                    <option value="">Select salon</option>
                    {refs.salons.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </Input>
                </Field>
              )}
              <Field icon="building" label="Branch">
                <Input type="select" value={form.branchId} disabled={user?.role === "RECEPTIONIST"} onChange={set("branchId")}>
                  <option value="">All branches</option>
                  {refs.branches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Input>
              </Field>
              <Field icon="user" label="Customer" hint="(optional)">
                <RSelect
                  isClearable
                  placeholder="Search customer by name, phone, email or ID..."
                  options={customerOptions}
                  value={customerOptions.find((o) => o.value && o.value === form.customerId) || null}
                  onChange={(option) => setForm((current) => ({ ...current, customerId: option?.value || "" }))}
                  filterOption={matches}
                  formatOptionLabel={richLabel}
                />
              </Field>
              <Field icon="wallet" label="Payment method">
                <Input type="select" value={form.paymentMethod} onChange={set("paymentMethod")}>
                  {PAYMENT_METHODS.map((x) => <option key={x}>{x}</option>)}
                </Input>
              </Field>
            </div>

            <div className="retail-tile">
              <div className="retail-line retail-line-head">
                <div className="retail-label"><Icon name="package" />Product</div>
                <div className="retail-label"><Icon name="box" />Quantity</div>
                <div className="retail-label"><Icon name="tag-alt" />Unit price</div>
                <div className="retail-label"><Icon name="coins" />Line total</div>
                <span />
              </div>
              {items.map((item, index) => (
                <div className="retail-line" key={index}>
                  <RSelect
                    aria-label="Product"
                    placeholder="Search product by name, code or category..."
                    options={productOptions}
                    value={productOptions.find((o) => o.value === item.productId) || null}
                    isOptionDisabled={(o) => items.some((other, i) => i !== index && other.productId === o.value)}
                    onChange={(option) => updateLine(index, { productId: option.value, price: priceOf(option.value) })}
                    filterOption={matches}
                    formatOptionLabel={richLabel}
                  />
                  <Input aria-label="Quantity" type="number" min="0.01" step="0.01" value={item.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} />
                  <Input aria-label="Unit price" type="number" min="0" step="0.01" value={item.price} onChange={(e) => updateLine(index, { price: e.target.value })} />
                  <strong className="retail-line-total">{formatMoney(Number(item.quantity || 0) * Number(item.price || 0))}</strong>
                  <button
                    type="button"
                    className="retail-remove"
                    title="Remove item"
                    disabled={items.length === 1}
                    onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              ))}
              <button type="button" className="retail-add" onClick={() => setItems((current) => [...current, emptyLine()])}>
                <Icon name="plus" />Add more items
              </button>
            </div>

            <div className="retail-split">
              <Field icon="notes-alt" label="Note">
                <Input type="textarea" rows="3" maxLength={NOTE_LIMIT} placeholder="Add notes for this sale..." value={form.note} onChange={set("note")} />
                <div className="retail-count">{form.note.length}/{NOTE_LIMIT}</div>
              </Field>
              <Field icon="percent" label="Discount & tax">
                <div className="retail-pair">
                  <div className="input-group">
                    <Input aria-label="Discount percent" type="number" min="0" max="100" step="0.01" value={form.discountPercent} onChange={set("discountPercent")} />
                    <span className="input-group-text">%</span>
                  </div>
                  <Input aria-label="Tax" type="select" value={form.taxPercent} onChange={set("taxPercent")}>
                    {TAX_OPTIONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                  </Input>
                </div>
                <div className="retail-note"><Icon name="info" />Discount is applied to the subtotal, tax after discount.</div>
              </Field>
            </div>
          </div>

          <aside className="retail-aside">
            <div className="retail-quick">
              <div className="retail-quick-head">
                <span className="retail-quick-icon"><Icon name="tag-alt" /></span>
                <div className="flex-grow-1">
                  <strong>Quick Add</strong>
                  <small>Scan or search product to add to cart</small>
                </div>
                <Icon name="scan" className="retail-quick-scan" />
              </div>
              <RSelect
                aria-label="Quick add product"
                placeholder="Scan barcode or type a name..."
                options={productOptions}
                value={null}
                onChange={quickAdd}
                filterOption={matches}
                formatOptionLabel={richLabel}
              />
            </div>

            <div className="retail-summary">
              <h6><Icon name="file-text" />Sale Summary</h6>
              <dl>
                <div><dt>Items</dt><dd>{unitCount}</dd></div>
                <div><dt>Subtotal</dt><dd>{formatMoney(subtotal)}</dd></div>
                <div><dt>Discount</dt><dd>{formatMoney(manualDiscount)}</dd></div>
                {taxAmount > 0 && <div><dt>Tax</dt><dd>{formatMoney(taxAmount)}</dd></div>}
              </dl>
              <div className="retail-total"><span>Total</span><strong>{formatMoney(total)}</strong></div>
              <button type="submit" className="retail-cta" disabled={saving}>
                {saving ? <Spinner size="sm" /> : <Icon name="bag" />}
                Complete sale
                <Icon name="arrow-right" />
              </button>
              <div className="retail-tagline"><Icon name="bag-fill" />Great products. Happy customers.</div>
            </div>
          </aside>
        </form>

        <DataGrid
          loading={loading}
          rows={visibleHistory}
          header={
            <div className="retail-history-head">
              <h5><Icon name="history" />Retail sale history</h5>
              <Input aria-label="Date range" type="select" value={filter.range} onChange={(e) => setFilter((f) => ({ ...f, range: e.target.value }))}>
                {DATE_RANGES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </Input>
              <div className="cust-field">
                <Icon name="search" className="cust-field-icon" />
                <Input className="cust-input" placeholder="Search by code, customer or product..." value={filter.search} onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))} />
              </div>
            </div>
          }
          emptyText={
            <div className="retail-empty">
              <span><Icon name="file-text" /></span>
              <div>
                <strong>No records found.</strong>
                <small>{history.length ? "No sales match these filters." : "Completed sales will appear here."}</small>
              </div>
            </div>
          }
          columns={[
            { key: "saleCode", label: "Code" },
            { key: "saleDate", label: <>Date <Icon name="arrow-down" /></>, render: (v) => formatDate(v, true) },
            { key: "customer", label: "Customer", render: (v) => v?.name || "Walk-in" },
            { key: "items", label: "Items", render: (v) => v?.length || 0 },
            { key: "taxAmount", label: "Tax", render: formatMoney },
            { key: "discountAmount", label: "Discount", render: formatMoney },
            { key: "totalAmount", label: "Total", render: formatMoney },
          ]}
        />
      </Content>
    </>
  );
};

export default RetailProducts;
