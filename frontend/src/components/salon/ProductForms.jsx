/* eslint-disable react-hooks/set-state-in-effect, react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Col,
  Form,
  FormGroup,
  Input,
  Label,
  Nav,
  NavItem,
  Offcanvas,
  OffcanvasBody,
  OffcanvasHeader,
  Row,
  Spinner,
} from "reactstrap";
import { Link } from "react-router-dom";
import { Button, Icon } from "@/components/Component";
import SchemaModal from "./SchemaModal";
import { salonApi } from "@/services/salonApi";
import { formatMoney, labelize } from "@/utils/salonFormat";

export const UNITS = ["PCS", "ML", "LITER", "GRAM", "KG", "PACK", "BOX", "BOTTLE", "TUBE"];

// Product writes are SUPER_ADMIN / SALON_ADMIN only on the API.
export const canManageProducts = (role) => role === "SUPER_ADMIN" || role === "SALON_ADMIN";

export const stockStatus = (product) => {
  const stock = Number(product.currentStock);
  if (stock <= 0) return { key: "out", label: "Out of Stock", color: "danger" };
  const min = Number(product.lowStockAlert);
  if (min > 0 && stock <= min) return { key: "low", label: "Low Stock", color: "warning" };
  return { key: "in", label: "In Stock", color: "success" };
};

export const StockBadge = ({ product }) => {
  if (!product.status) return <span className="badge bg-light text-dark">Inactive</span>;
  const s = stockStatus(product);
  return <span className={`badge badge-dim bg-${s.color}`}>{s.label}</span>;
};

export const KpiCard = ({ label, value, tone }) => (
  <div className="card card-bordered h-100">
    <div className="card-inner py-3">
      <div className="overline-title text-soft">{label}</div>
      <div className={`fs-3 fw-bold ${tone ? `text-${tone}` : ""}`}>{value}</div>
    </div>
  </div>
);

export const InfoList = ({ title, items }) => (
  <div className="card card-bordered h-100">
    <div className="card-inner">
      <h6 className="overline-title text-soft mb-3">{title}</h6>
      <dl className="mb-0">
        {items.map(([label, value]) => (
          <div key={label} className="d-flex justify-content-between py-1 border-bottom border-light">
            <dt className="fw-normal text-soft">{label}</dt>
            <dd className="mb-0 fw-medium text-end">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  </div>
);

export const formatQty = (value) =>
  Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** Brands, vendors, branches and (for super admins) salons used by the product form. */
export const useProductRefs = (role) => {
  const [refs, setRefs] = useState({ brands: [], vendors: [], branches: [], salons: [] });
  const load = useCallback(() => {
    Promise.allSettled([
      salonApi.productBrands.list(),
      salonApi.vendors.list(),
      role === "STAFF" ? Promise.resolve({ data: [] }) : salonApi.branches.list(),
      role === "SUPER_ADMIN" ? salonApi.salons.list() : Promise.resolve({ data: [] }),
    ]).then(([brands, vendors, branches, salons]) => {
      const value = (r) => (r.status === "fulfilled" ? r.value.data || [] : []);
      setRefs({ brands: value(brands), vendors: value(vendors), branches: value(branches), salons: value(salons) });
    });
  }, [role]);
  useEffect(() => { if (role) load(); }, [load, role]);
  return [refs, load];
};

const emptyProduct = {
  name: "",
  brandId: "",
  category: "",
  sku: "",
  barcode: "",
  hsnCode: "",
  unit: "PCS",
  costPrice: "",
  sellingPrice: "",
  openingStock: "",
  lowStockAlert: "",
  vendorId: "",
  branchId: "",
  salonId: "",
  description: "",
  isRetailProduct: true,
  isServiceConsumable: false,
};

const Section = ({ title, children }) => (
  <div className="mb-4">
    <h6 className="overline-title text-primary mb-3">{title}</h6>
    <Row className="g-3">{children}</Row>
  </div>
);

/**
 * Add / edit product drawer. Opening stock is posted as a STOCK_IN movement
 * after the product is created, so it shows up in Stock History.
 */
export const ProductDrawer = ({ isOpen, toggle, product, refs, reloadRefs, categories = [], role, onSaved }) => {
  const editing = Boolean(product?.id);
  const [form, setForm] = useState(emptyProduct);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [quickAdd, setQuickAdd] = useState(null); // "vendor" | "brand"

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    setForm(product ? {
      ...emptyProduct,
      ...Object.fromEntries(Object.keys(emptyProduct).map((k) => [k, product[k] ?? emptyProduct[k]])),
      brandId: product.brandId || "",
      vendorId: product.vendorId || "",
      branchId: product.branchId || "",
    } : emptyProduct);
  }, [isOpen, product]);

  const set = (key) => (e) => {
    const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const cost = Number(form.costPrice || 0);
  const price = Number(form.sellingPrice || 0);
  const profit = price - cost;
  const margin = price > 0 ? (profit / price) * 100 : 0;

  const save = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) return setError("Product name is required.");
    if (!form.category.trim()) return setError("Category is required.");
    if (role === "SUPER_ADMIN" && !editing && !form.salonId) return setError("Salon is required.");
    setSaving(true);
    try {
      const body = {
        name: form.name,
        brandId: form.brandId || null,
        vendorId: form.vendorId || null,
        category: form.category,
        sku: form.sku || null,
        barcode: form.barcode || null,
        hsnCode: form.hsnCode || null,
        unit: form.unit,
        costPrice: cost,
        sellingPrice: price,
        lowStockAlert: Number(form.lowStockAlert || 0),
        description: form.description || null,
        isRetailProduct: form.isRetailProduct,
        isServiceConsumable: form.isServiceConsumable,
        ...(role !== "STAFF" ? { branchId: form.branchId || null } : {}),
        ...(!editing && form.salonId ? { salonId: form.salonId } : {}),
      };
      let saved;
      if (editing) {
        saved = (await salonApi.products.update(product.id, body)).data;
      } else {
        saved = (await salonApi.products.create(body)).data;
        const opening = Number(form.openingStock || 0);
        if (opening > 0) {
          try {
            await salonApi.stockMovements.createManual({
              salonId: saved.salonId,
              productId: saved.id,
              type: "STOCK_IN",
              quantity: opening,
              reason: "Opening stock",
            });
          } catch (stockError) {
            // The product exists now; saving again would be a duplicate.
            await onSaved?.(saved);
            toggle();
            window.alert(`Product saved, but opening stock was not added: ${stockError.message}. Use "Add Stock" instead.`);
            return;
          }
        }
      }
      await onSaved?.(saved);
      toggle();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const salonIdForRefs = editing ? product.salonId : form.salonId;

  return (
    <>
      <Offcanvas isOpen={isOpen} toggle={toggle} direction="end" style={{ width: 560, maxWidth: "100vw" }}>
        <OffcanvasHeader toggle={toggle}>{editing ? "Edit Product" : "Add Product"}</OffcanvasHeader>
        <OffcanvasBody>
          <Form onSubmit={save}>
            {error && <Alert color="danger"><Icon name="alert-circle" className="me-1" />{error}</Alert>}

            <Section title="Basic Information">
              {role === "SUPER_ADMIN" && !editing && (
                <Col xs="12"><FormGroup><Label>Salon <span className="text-danger">*</span></Label>
                  <Input type="select" value={form.salonId} onChange={set("salonId")}>
                    <option value="">Select salon</option>
                    {refs.salons.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </Input></FormGroup></Col>
              )}
              <Col xs="12"><FormGroup><Label>Product Name <span className="text-danger">*</span></Label>
                <Input value={form.name} onChange={set("name")} placeholder="L'Oréal Professional Shampoo" autoFocus /></FormGroup></Col>
              <Col sm="6"><FormGroup>
                <div className="d-flex justify-content-between"><Label>Brand</Label>
                  <a href="#new-brand" className="small" onClick={(e) => { e.preventDefault(); setQuickAdd("brand"); }}>+ New</a></div>
                <Input type="select" value={form.brandId} onChange={set("brandId")}>
                  <option value="">Generic</option>
                  {refs.brands.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Input></FormGroup></Col>
              <Col sm="6"><FormGroup><Label>Category <span className="text-danger">*</span></Label>
                <Input value={form.category} onChange={set("category")} list="product-categories" placeholder="Hair Care" />
                <datalist id="product-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
              </FormGroup></Col>
              <Col sm="6"><FormGroup><Label>SKU</Label><Input value={form.sku} onChange={set("sku")} placeholder="LR-SHP-001" /></FormGroup></Col>
              <Col sm="6"><FormGroup><Label>Barcode</Label><Input value={form.barcode} onChange={set("barcode")} /></FormGroup></Col>
              <Col sm="6"><FormGroup><Label>HSN Code</Label><Input value={form.hsnCode} onChange={set("hsnCode")} placeholder="3305" /></FormGroup></Col>
              <Col sm="6"><FormGroup><Label>Unit</Label>
                <Input type="select" value={form.unit} onChange={set("unit")}>{UNITS.map((u) => <option key={u}>{u}</option>)}</Input></FormGroup></Col>
            </Section>

            <Section title="Pricing">
              <Col sm="6"><FormGroup><Label>Purchase Price (₹)</Label>
                <Input type="number" min="0" step="0.01" value={form.costPrice} onChange={set("costPrice")} /></FormGroup></Col>
              <Col sm="6"><FormGroup><Label>Selling Price (₹)</Label>
                <Input type="number" min="0" step="0.01" value={form.sellingPrice} onChange={set("sellingPrice")} /></FormGroup></Col>
              <Col xs="12">
                <div className={`rounded px-3 py-2 bg-${profit < 0 ? "danger" : "success"}-dim d-flex gap-4`}>
                  <span>Profit / Unit: <strong>{formatMoney(profit)}</strong></span>
                  <span>Margin: <strong>{margin.toFixed(1)}%</strong></span>
                </div>
                <div className="form-note mt-1">GST on products uses the salon&apos;s product GST rate from settings.</div>
              </Col>
            </Section>

            <Section title="Inventory">
              {!editing && (
                <Col sm="6"><FormGroup><Label>Opening Stock</Label>
                  <Input type="number" min="0" step="0.01" value={form.openingStock} onChange={set("openingStock")} /></FormGroup></Col>
              )}
              <Col sm="6"><FormGroup><Label>Low Stock Alert</Label>
                <Input type="number" min="0" step="0.01" value={form.lowStockAlert} onChange={set("lowStockAlert")} /></FormGroup></Col>
              <Col xs="12"><FormGroup>
                <div className="d-flex justify-content-between"><Label>Preferred Vendor</Label>
                  <a href="#new-vendor" className="small" onClick={(e) => { e.preventDefault(); setQuickAdd("vendor"); }}>+ Add New Vendor</a></div>
                <Input type="select" value={form.vendorId} onChange={set("vendorId")}>
                  <option value="">No preferred vendor</option>
                  {refs.vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Input></FormGroup></Col>
            </Section>

            <Section title="More Options">
              {role !== "STAFF" && (
                <Col xs="12"><FormGroup><Label>Branch</Label>
                  <Input type="select" value={form.branchId} onChange={set("branchId")}>
                    <option value="">All branches</option>
                    {refs.branches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </Input></FormGroup></Col>
              )}
              <Col sm="6"><FormGroup check><Input type="checkbox" id="pf-retail" checked={form.isRetailProduct} onChange={set("isRetailProduct")} />
                <Label check for="pf-retail">Sold to customers</Label></FormGroup></Col>
              <Col sm="6"><FormGroup check><Input type="checkbox" id="pf-consumable" checked={form.isServiceConsumable} onChange={set("isServiceConsumable")} />
                <Label check for="pf-consumable">Used in services</Label></FormGroup></Col>
              <Col xs="12"><FormGroup><Label>Description</Label>
                <Input type="textarea" rows="2" value={form.description} onChange={set("description")} /></FormGroup></Col>
            </Section>

            <div className="d-flex gap-2 justify-content-end">
              <Button type="button" color="light" onClick={toggle}>Cancel</Button>
              <Button type="submit" color="primary" disabled={saving}>
                {saving && <Spinner size="sm" className="me-1" />}Save Product
              </Button>
            </div>
          </Form>
        </OffcanvasBody>
      </Offcanvas>

      <SchemaModal
        isOpen={quickAdd === "vendor"}
        toggle={() => setQuickAdd(null)}
        title="Add New Vendor"
        submitLabel="Add Vendor"
        fields={[
          { name: "name", label: "Vendor name", required: true },
          { name: "phone", label: "Phone", nullable: true },
          { name: "contactPerson", label: "Contact person", nullable: true },
          { name: "gst", label: "GST number", nullable: true },
        ]}
        onSubmit={async (values) => {
          const { data } = await salonApi.vendors.create({ ...values, ...(salonIdForRefs ? { salonId: salonIdForRefs } : {}) });
          await reloadRefs();
          setForm((f) => ({ ...f, vendorId: data.id }));
        }}
      />
      <SchemaModal
        isOpen={quickAdd === "brand"}
        toggle={() => setQuickAdd(null)}
        title="Add New Brand"
        submitLabel="Add Brand"
        fields={[{ name: "name", label: "Brand name", required: true, fullWidth: true }]}
        onSubmit={async (values) => {
          const { data } = await salonApi.productBrands.create({ ...values, ...(salonIdForRefs ? { salonId: salonIdForRefs } : {}) });
          await reloadRefs();
          setForm((f) => ({ ...f, brandId: data.id }));
        }}
      />
    </>
  );
};

/** Add stock = a one-line purchase, so it lands in Purchases, Stock History and the vendor balance. */
export const AddStockModal = ({ isOpen, toggle, product, vendors, onSaved }) => {
  // Stable props: SchemaModal resets its values whenever these change identity.
  const initialValues = useMemo(
    () => (product ? { vendorId: product.vendorId || "", unitCost: Number(product.costPrice) } : undefined),
    [product]
  );
  const fields = useMemo(() => [
    { name: "quantity", label: `Quantity${product ? ` (${product.unit})` : ""}`, type: "number", min: 0.01, step: "0.01", required: true },
    { name: "unitCost", label: "Rate (₹ per unit)", type: "number", min: 0, step: "0.01", required: true },
    { name: "vendorId", label: "Vendor", type: "select", nullable: true, options: vendors.map((x) => ({ value: x.id, label: x.name })) },
    { name: "invoiceNo", label: "Vendor invoice no.", nullable: true },
    { name: "purchaseDate", label: "Purchase date", type: "date", defaultValue: new Date().toISOString().slice(0, 10) },
    { name: "note", label: "Note", nullable: true },
  ], [product, vendors]);
  return (
  <SchemaModal
    isOpen={isOpen}
    toggle={toggle}
    title={product ? `Add Stock — ${product.name}` : "Add Stock"}
    submitLabel="Add Stock"
    initialValues={initialValues}
    fields={fields}
    onSubmit={async (v) => {
      await salonApi.productPurchases.create({
        salonId: product.salonId,
        ...(product.branchId ? { branchId: product.branchId } : {}),
        ...(v.vendorId ? { vendorId: v.vendorId } : {}),
        ...(v.invoiceNo ? { invoiceNo: v.invoiceNo } : {}),
        ...(v.purchaseDate ? { purchaseDate: v.purchaseDate } : {}),
        ...(v.note ? { note: v.note } : {}),
        items: [{ productId: product.id, quantity: v.quantity, unitCost: v.unitCost }],
      });
      await onSaved?.();
    }}
  />
  );
};

export const ADJUST_TYPES = [
  { value: "ADJUSTMENT", label: "Stock count correction (+/-)" },
  { value: "DAMAGED", label: "Damaged" },
  { value: "USED_IN_SERVICE", label: "Used in service" },
  { value: "STOCK_OUT", label: "Expired / removed" },
  { value: "RETURNED", label: "Returned to stock" },
];

const ADJUST_FIELDS = [
  { name: "type", label: "Reason type", type: "select", required: true, defaultValue: "ADJUSTMENT", options: ADJUST_TYPES },
  { name: "quantity", label: "Quantity", type: "number", step: "0.01", required: true, help: "Negative values are allowed only for count corrections." },
  { name: "reason", label: "Reason", required: true, fullWidth: true },
];

export const AdjustStockModal = ({ isOpen, toggle, product, onSaved }) => (
  <SchemaModal
    isOpen={isOpen}
    toggle={toggle}
    title={product ? `Adjust Stock — ${product.name} (now ${formatQty(product.currentStock)})` : "Adjust Stock"}
    submitLabel="Update Stock"
    fields={ADJUST_FIELDS}
    onSubmit={async (v) => {
      await salonApi.stockMovements.createManual({ ...v, salonId: product.salonId, productId: product.id });
      await onSaved?.();
    }}
  />
);

/** Tabs whose state lives in the URL path: `${base}` for the first tab, `${base}/${key}` for the rest. */
export const RouteTabs = ({ base, tabs, active }) => (
  <Nav tabs className="mb-4">
    {tabs.map((t, i) => (
      <NavItem key={t.key}>
        <Link className={`nav-link${active === t.key ? " active" : ""}`} to={i === 0 ? base : `${base}/${t.key}`} replace>
          {t.label}
          {t.badge ? <span className="badge bg-danger ms-1">{t.badge}</span> : null}
        </Link>
      </NavItem>
    ))}
  </Nav>
);

const MOVEMENT_LABELS = {
  STOCK_IN: "Stock In",
  STOCK_OUT: "Stock Out",
  RETAIL_SALE: "Product Sale",
  USED_IN_SERVICE: "Used in Service",
  DAMAGED: "Damaged",
  ADJUSTMENT: "Adjustment",
  RETURNED: "Return",
};

export const movementLabel = (m) => {
  if (m.reason === "Opening stock") return "Opening Stock";
  if (m.referenceType === "PRODUCT_PURCHASE") return "Purchase";
  return MOVEMENT_LABELS[m.type] || labelize(m.type);
};

export const movementDelta = (m) => Number(m.stockAfter) - Number(m.stockBefore);

/** Same rule the backend uses for reorder suggestions: refill to twice the minimum. */
export const suggestedOrderQty = (p) =>
  Math.max(Number(p.lowStockAlert) * 2 - Math.max(Number(p.currentStock), 0), 1);

export const PAYMENT_METHODS = ["CASH", "UPI", "GPAY", "PAYTM", "PHONEPE", "CARD", "BANK_TRANSFER", "CHEQUE", "OTHER"];

export const VENDOR_FIELDS = [
  { name: "name", label: "Vendor name", required: true },
  { name: "contactPerson", label: "Contact person", nullable: true },
  { name: "phone", label: "Phone", nullable: true },
  { name: "email", label: "Email", type: "email", nullable: true },
  { name: "gst", label: "GST number", nullable: true },
  { name: "paymentTerms", label: "Payment terms", nullable: true, placeholder: "e.g. 30 days" },
  { name: "address", label: "Address", type: "textarea", fullWidth: true, nullable: true },
];
