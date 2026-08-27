/* eslint-disable react/prop-types, react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import { Alert, Col, Form, FormGroup, Input, Label, Row, Spinner } from "reactstrap";
import { Button, Icon } from "@/components/Component";
import PageShell from "./PageShell";
import DataGrid from "./DataGrid";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import { formatDate, formatMoney } from "@/utils/salonFormat";

const emptyLine = () => ({ productId: "", quantity: 1, price: 0 });
const TAX_OPTIONS = [
  { value: 0, label: "No tax" },
  { value: 5, label: "GST 5%" },
  { value: 12, label: "GST 12%" },
  { value: 18, label: "GST 18%" },
  { value: 28, label: "GST 28%" },
];

const InventoryTransactionPage = ({ mode }) => {
  const purchase = mode === "purchase";
  const { user } = useAuth();
  const [refs, setRefs] = useState({ products: [], vendors: [], branches: [], customers: [], salons: [] });
  const [history, setHistory] = useState([]);
  const [form, setForm] = useState({
    salonId: "",
    branchId: "",
    vendorId: "",
    purchaseDate: new Date().toISOString().slice(0, 10),
    supplierName: "",
    supplierPhone: "",
    invoiceNo: "",
    customerId: "",
    paymentMethod: "CASH",
    discountAmount: 0,
    taxPercent: 0,
    note: "",
  });
  const [items, setItems] = useState([emptyLine()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const api = purchase ? salonApi.productPurchases : salonApi.retailSales;

  const load = async () => {
    setLoading(true);
    try {
      const [products, vendors, branches, customers, salons, records] = await Promise.allSettled([
        salonApi.products.list(purchase ? {} : { retail: true, status: true }),
        purchase ? salonApi.vendors.list({ status: true }) : Promise.resolve({ data: [] }),
        user?.role === "STAFF" ? Promise.resolve({ data: [] }) : salonApi.branches.list(),
        purchase ? Promise.resolve({ data: [] }) : salonApi.customers.list(),
        user?.role === "SUPER_ADMIN" ? salonApi.salons.list() : Promise.resolve({ data: [] }),
        api.list(),
      ]);
      setRefs({
        products: products.status === "fulfilled" ? products.value.data || [] : [],
        vendors: vendors.status === "fulfilled" ? vendors.value.data || [] : [],
        branches: branches.status === "fulfilled" ? branches.value.data || [] : [],
        customers: customers.status === "fulfilled" ? customers.value.data || [] : [],
        salons: salons.status === "fulfilled" ? salons.value.data || [] : [],
      });
      setHistory(records.status === "fulfilled" ? records.value.data || [] : []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  // The page reloads when switching between purchase and retail mode.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [mode]);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.price || 0), 0),
    [items]
  );
  const selectedCustomer = refs.customers.find((item) => item.id === form.customerId);
  const membershipPercent = Number(selectedCustomer?.membership?.discountPercentage || 0);
  const manualDiscount = Math.min(Number(form.discountAmount || 0), total);
  const membershipDiscount = purchase
    ? 0
    : Math.min(
        total * (membershipPercent / 100),
        Math.max(total - manualDiscount, 0)
      );
  const discountTotal = manualDiscount + membershipDiscount;
  const taxableTotal = Math.max(total - discountTotal, 0);
  const taxAmount = purchase ? 0 : taxableTotal * (Number(form.taxPercent || 0) / 100);
  const finalTotal = purchase ? total : taxableTotal + taxAmount;

  const updateLine = (index, patch) => setItems((current) =>
    current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)
  );

  const selectProduct = (index, productId) => {
    const product = refs.products.find((item) => item.id === productId);
    updateLine(index, {
      productId,
      price: Number(purchase ? product?.costPrice : product?.sellingPrice) || 0,
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (items.some((item) => !item.productId || Number(item.quantity) <= 0)) {
      setError("Select a product and enter a positive quantity for every line.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...(form.salonId ? { salonId: form.salonId } : {}),
        ...(form.branchId ? { branchId: form.branchId } : {}),
        ...(purchase && form.purchaseDate ? { purchaseDate: form.purchaseDate } : {}),
        ...(form.note ? { note: form.note } : {}),
        ...(purchase
          ? {
              supplierName: form.supplierName,
              supplierPhone: form.supplierPhone,
              ...(form.vendorId ? { vendorId: form.vendorId } : {}),
              invoiceNo: form.invoiceNo,
              items: items.map((item) => ({
                productId: item.productId,
                quantity: Number(item.quantity),
                unitCost: Number(item.price),
              })),
            }
          : {
              ...(form.customerId ? { customerId: form.customerId } : {}),
              paymentMethod: form.paymentMethod,
              discountAmount: Number(form.discountAmount || 0),
              taxPercent: Number(form.taxPercent || 0),
              items: items.map((item) => ({
                productId: item.productId,
                quantity: Number(item.quantity),
                unitPrice: Number(item.price),
              })),
            }),
      };
      await api.create(body);
      setMessage(purchase ? "Purchase saved and stock increased." : "Retail sale saved and stock decreased.");
      setItems([emptyLine()]);
      await load();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title={purchase ? "Purchase products" : "Retail products"}
      description={purchase ? "Receive vendor stock into inventory." : "Sell retail products to customers and reduce stock."}
    >
      {error && <Alert color="danger">{error}</Alert>}
      {message && <Alert color="success">{message}</Alert>}
      <div className="card card-bordered mb-4">
        <div className="card-inner">
          <Form onSubmit={submit}>
            <Row className="g-3">
              {user?.role === "SUPER_ADMIN" && (
                <Col md="4"><FormGroup><Label>Salon</Label><Input type="select" required value={form.salonId} onChange={(e) => setForm((x) => ({ ...x, salonId: e.target.value }))}><option value="">Select salon</option>{refs.salons.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Input></FormGroup></Col>
              )}
              <Col md="4"><FormGroup><Label>Branch</Label><Input type="select" value={form.branchId} disabled={user?.role === "RECEPTIONIST"} onChange={(e) => setForm((x) => ({ ...x, branchId: e.target.value }))}><option value="">All branches</option>{refs.branches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Input></FormGroup></Col>
              {purchase ? (
                <>
                  <Col md="4"><FormGroup><Label>Vendor</Label><Input type="select" value={form.vendorId} onChange={(e) => setForm((x) => ({ ...x, vendorId: e.target.value }))}><option value="">Select vendor (optional)</option>{refs.vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Input></FormGroup></Col>
                  <Col md="4"><FormGroup><Label>Purchase date</Label><Input type="date" value={form.purchaseDate} onChange={(e) => setForm((x) => ({ ...x, purchaseDate: e.target.value }))} /></FormGroup></Col>
                  <Col md="4"><FormGroup><Label>Supplier name</Label><Input value={form.supplierName} onChange={(e) => setForm((x) => ({ ...x, supplierName: e.target.value }))} /></FormGroup></Col>
                  <Col md="4"><FormGroup><Label>Supplier phone</Label><Input value={form.supplierPhone} onChange={(e) => setForm((x) => ({ ...x, supplierPhone: e.target.value }))} /></FormGroup></Col>
                  <Col md="4"><FormGroup><Label>Invoice no.</Label><Input value={form.invoiceNo} onChange={(e) => setForm((x) => ({ ...x, invoiceNo: e.target.value }))} /></FormGroup></Col>
                </>
              ) : (
                <>
                  <Col md="4"><FormGroup><Label>Customer (optional)</Label><Input type="select" value={form.customerId} onChange={(e) => setForm((x) => ({ ...x, customerId: e.target.value }))}><option value="">Walk-in customer</option>{refs.customers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Input></FormGroup></Col>
                  <Col md="4"><FormGroup><Label>Payment method</Label><Input type="select" value={form.paymentMethod} onChange={(e) => setForm((x) => ({ ...x, paymentMethod: e.target.value }))}>{["CASH", "UPI", "GPAY", "PAYTM", "PHONEPE", "CARD", "BANK_TRANSFER", "CHEQUE", "OTHER"].map((x) => <option key={x}>{x}</option>)}</Input></FormGroup></Col>
                  <Col md="4"><FormGroup><Label>Tax</Label><Input type="select" value={form.taxPercent} onChange={(e) => setForm((x) => ({ ...x, taxPercent: e.target.value }))}>{TAX_OPTIONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</Input></FormGroup></Col>
                </>
              )}
            </Row>
            <div className="table-responsive mt-3">
              <table className="table">
                <thead><tr><th>Product</th><th style={{ width: 140 }}>Quantity</th><th style={{ width: 170 }}>{purchase ? "Unit cost" : "Unit price"}</th><th style={{ width: 140 }}>Line total</th><th /></tr></thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={index}>
                      <td><Input type="select" required value={item.productId} onChange={(e) => selectProduct(index, e.target.value)}><option value="">Select product</option>{refs.products.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currentStock} {x.unit})</option>)}</Input></td>
                      <td><Input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} /></td>
                      <td><Input type="number" min="0" step="0.01" value={item.price} onChange={(e) => updateLine(index, { price: e.target.value })} /></td>
                      <td>{formatMoney(Number(item.quantity || 0) * Number(item.price || 0))}</td>
                      <td><Button type="button" color="danger" outline size="sm" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, i) => i !== index))}><Icon name="trash" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button type="button" color="light" onClick={() => setItems((current) => [...current, emptyLine()])}><Icon name="plus" /> Add line</Button>
            <Row className="g-3 mt-2 align-items-end">
              <Col md="8"><FormGroup><Label>Note</Label><Input type="textarea" value={form.note} onChange={(e) => setForm((x) => ({ ...x, note: e.target.value }))} /></FormGroup></Col>
              {!purchase && <Col md="2"><FormGroup><Label>Discount</Label><Input type="number" min="0" step="0.01" value={form.discountAmount} onChange={(e) => setForm((x) => ({ ...x, discountAmount: e.target.value }))} /></FormGroup></Col>}
              <Col md={purchase ? "4" : "2"} className="text-end">
                {!purchase && (
                  <div className="small text-soft mb-2">
                    {membershipDiscount > 0 && <div>Membership -{formatMoney(membershipDiscount)}</div>}
                    {taxAmount > 0 && <div>Tax {formatMoney(taxAmount)}</div>}
                  </div>
                )}
                <div className="mb-2 text-soft">Total</div><h4>{formatMoney(finalTotal)}</h4><Button color="primary" type="submit" disabled={saving}>{saving && <Spinner size="sm" className="me-1" />}{purchase ? "Save purchase" : "Complete sale"}</Button></Col>
            </Row>
          </Form>
        </div>
      </div>
      <h5 className="mb-3">{purchase ? "Purchase history" : "Retail sale history"}</h5>
      <DataGrid
        loading={loading}
        rows={history}
        columns={[
          { key: purchase ? "purchaseCode" : "saleCode", label: "Code" },
          { key: purchase ? "purchaseDate" : "saleDate", label: "Date", render: (v) => formatDate(v, true) },
          { key: purchase ? "supplierName" : "customer", label: purchase ? "Supplier" : "Customer", render: (v) => purchase ? (v || "—") : (v?.name || "Walk-in") },
          { key: "items", label: "Items", render: (v) => v?.length || 0 },
          ...(!purchase ? [{ key: "taxAmount", label: "Tax", render: formatMoney }] : []),
          ...(!purchase ? [{ key: "discountAmount", label: "Discount", render: formatMoney }] : []),
          { key: "totalAmount", label: "Total", render: formatMoney },
          ...(purchase ? [{ key: "paymentStatus", label: "Payment" }] : []),
          ...(purchase ? [{ key: "balanceAmount", label: "Balance", render: formatMoney }] : []),
        ]}
      />
    </PageShell>
  );
};

export default InventoryTransactionPage;
