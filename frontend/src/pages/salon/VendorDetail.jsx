/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, Col, Row } from "reactstrap";
import { Button, Icon } from "@/components/Component";
import DataGrid from "@/components/salon/DataGrid";
import PageShell from "@/components/salon/PageShell";
import SchemaModal from "@/components/salon/SchemaModal";
import StatusBadge from "@/components/salon/StatusBadge";
import {
  InfoList,
  KpiCard,
  PAYMENT_METHODS,
  RouteTabs,
  StockBadge,
  VENDOR_FIELDS,
  canManageProducts,
  formatQty,
} from "@/components/salon/ProductForms";
import { LoaderOne } from "@/components/ui/loader";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import { allowsRole, formatDate, formatMoney, labelize, todayInputDate } from "@/utils/salonFormat";

const VendorDetail = () => {
  const { vendorId, tab: tabParam } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = canManageProducts(user?.role);
  // Purchase and payment lists are admin / branch-manager only on the API.
  const canSeeLedger = allowsRole(["SUPER_ADMIN", "SALON_ADMIN"], user?.role);
  const [vendor, setVendor] = useState(null);
  const [purchases, setPurchases] = useState([]);
  const [payments, setPayments] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [payFor, setPayFor] = useState(null); // null = closed, { purchaseId } = open

  const load = async () => {
    const [v, pu, pa, pr] = await Promise.allSettled([
      salonApi.vendors.get(vendorId),
      canSeeLedger ? salonApi.productPurchases.list({ vendorId }) : Promise.resolve({ data: [] }),
      canSeeLedger ? salonApi.vendorPayments.list({ vendorId }) : Promise.resolve({ data: [] }),
      salonApi.products.list({ vendorId }),
    ]);
    const data = (r) => (r.status === "fulfilled" ? r.value.data || [] : []);
    if (v.status === "fulfilled") setVendor(v.value.data);
    else setError(v.reason?.message || "Vendor not found.");
    setPurchases(data(pu));
    setPayments(data(pa));
    setProducts(data(pr));
    setLoading(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setLoading(true); load(); }, [vendorId]);

  const unpaid = purchases.filter((p) => Number(p.balanceAmount) > 0);
  const payFields = useMemo(() => [
    {
      name: "purchaseId",
      label: "Against purchase",
      type: "select",
      nullable: true,
      placeholder: "On account (no specific purchase)",
      options: unpaid.map((p) => ({ value: p.id, label: `${p.purchaseCode} — due ${formatMoney(p.balanceAmount)}` })),
    },
    { name: "amount", label: "Amount (₹)", type: "number", min: 0.01, step: "0.01", required: true },
    { name: "paymentMethod", label: "Payment mode", type: "select", required: true, defaultValue: "UPI", options: PAYMENT_METHODS.map((m) => ({ value: m, label: labelize(m) })) },
    { name: "paymentDate", label: "Payment date", type: "date", defaultValue: todayInputDate() },
    { name: "referenceNo", label: "Reference / Txn no.", nullable: true },
    { name: "note", label: "Note", nullable: true },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [purchases]);
  const payInitial = useMemo(() => {
    const p = purchases.find((x) => x.id === payFor?.purchaseId);
    return p ? { purchaseId: p.id, amount: Number(p.balanceAmount) } : undefined;
  }, [payFor, purchases]);

  if (loading) {
    return <PageShell title="Vendor"><div className="d-flex justify-content-center py-5 text-primary"><LoaderOne label="Loading vendor" /></div></PageShell>;
  }
  if (!vendor) {
    return (
      <PageShell title="Vendor">
        <Alert color="danger">{error || "Vendor not found."}</Alert>
        <Link to="/admin/vendors"><Icon name="arrow-left" /> Back to vendors</Link>
      </PageShell>
    );
  }

  const base = `/admin/vendors/${vendor.id}`;
  const tabs = [
    { key: "overview", label: "Overview" },
    ...(canSeeLedger ? [{ key: "purchases", label: "Purchases" }, { key: "payments", label: "Payments" }] : []),
    { key: "products", label: "Products" },
  ];
  const tab = tabs.some((t) => t.key === tabParam) ? tabParam : "overview";
  const due = Number(vendor.due || 0);

  return (
    <PageShell
      title={vendor.name}
      description={[vendor.phone, vendor.email, vendor.gst && `GST: ${vendor.gst}`].filter(Boolean).join(" · ") || "Vendor"}
      tools={
        <>
          <Link to="/admin/vendors" className="btn btn-light"><Icon name="arrow-left" /><span>Vendors</span></Link>
          {canManage && (
            <>
              <Button color="primary" outline onClick={() => setEditOpen(true)}><Icon name="edit" /><span>Edit</span></Button>
              <Button color="primary" outline onClick={() => setPayFor({})}><Icon name="wallet-out" /><span>Record Payment</span></Button>
              {vendor.status && (
                <Button color="primary" onClick={() => navigate(`/admin/inventory/receive?vendorId=${vendor.id}`)}><Icon name="cart" /><span>Create Purchase</span></Button>
              )}
            </>
          )}
        </>
      }
    >
      {error && <Alert color="danger">{error}</Alert>}
      <Row className="g-3 mb-4">
        <Col xs="6" lg="3"><KpiCard label="Total Purchased" value={formatMoney(vendor.totalPurchased)} /></Col>
        <Col xs="6" lg="3"><KpiCard label="Total Paid" value={formatMoney(vendor.totalPaid)} /></Col>
        <Col xs="6" lg="3">
          <KpiCard label={due < 0 ? "Advance Paid" : "Amount Due"} value={formatMoney(Math.abs(due))} tone={due > 0 ? "danger" : "success"} />
        </Col>
        <Col xs="6" lg="3"><KpiCard label="Last Purchase" value={vendor.lastPurchaseAt ? formatDate(vendor.lastPurchaseAt) : "—"} /></Col>
      </Row>

      <RouteTabs base={base} tabs={tabs} active={tab} />

      {tab === "overview" && (
        <Row className="g-3">
          <Col md="6">
            <InfoList title="Contact" items={[
              ["Contact person", vendor.contactPerson],
              ["Phone", vendor.phone],
              ["Email", vendor.email],
              ["GST", vendor.gst],
              ["Address", vendor.address],
            ]} />
          </Col>
          <Col md="6">
            <InfoList title="Account" items={[
              ["Status", <StatusBadge key="s" value={vendor.status} />],
              ["Payment terms", vendor.paymentTerms],
              ["Purchases", vendor._count?.productPurchases ?? 0],
              ["Payments", vendor._count?.vendorPayments ?? 0],
              ["Products supplied", vendor._count?.products ?? 0],
            ]} />
          </Col>
        </Row>
      )}

      {tab === "purchases" && (
        <DataGrid
          rows={purchases}
          emptyText="No purchases from this vendor yet."
          columns={[
            { key: "purchaseDate", label: "Date", render: (v) => formatDate(v) },
            { key: "purchaseCode", label: "Purchase #", render: (v, r) => <>{v}{r.invoiceNo && <div className="small text-soft">Inv: {r.invoiceNo}</div>}</> },
            { key: "items", label: "Products", render: (v) => v?.map((i) => `${i.product?.name} × ${formatQty(i.quantity)}`).join(", ") },
            { key: "totalAmount", label: "Total", render: formatMoney },
            { key: "paidAmount", label: "Paid", render: formatMoney },
            { key: "balanceAmount", label: "Due", render: (v) => <span className={Number(v) > 0 ? "text-danger" : ""}>{formatMoney(v)}</span> },
            { key: "paymentStatus", label: "Payment", render: labelize },
          ]}
          renderActions={canManage ? (row) => (
            Number(row.balanceAmount) > 0 ? <Button onClick={() => setPayFor({ purchaseId: row.id })}><Icon name="wallet-out" />Record Payment</Button> : null
          ) : undefined}
        />
      )}

      {tab === "payments" && (
        <DataGrid
          rows={payments}
          emptyText="No payments recorded."
          columns={[
            { key: "paymentDate", label: "Date", render: (v) => formatDate(v) },
            { key: "amount", label: "Payment", render: formatMoney },
            { key: "paymentMethod", label: "Mode", render: labelize },
            { key: "referenceNo", label: "Reference" },
            { key: "purchase", label: "Purchase", render: (v) => v?.purchaseCode || "On account" },
            { key: "note", label: "Note" },
          ]}
        />
      )}

      {tab === "products" && (
        <DataGrid
          rows={products}
          emptyText="No products list this vendor as preferred."
          columns={[
            { key: "name", label: "Product", render: (v, p) => <Link to={`/admin/products/${p.id}`}>{v}</Link> },
            { key: "currentStock", label: "Stock", render: (v, p) => `${formatQty(v)} ${p.unit}` },
            { key: "costPrice", label: "Cost", render: formatMoney },
            { key: "lastPurchaseAt", label: "Last Purchase", render: (v) => (v ? formatDate(v) : "—") },
            { key: "status", label: "Status", render: (_, p) => <StockBadge product={p} /> },
          ]}
        />
      )}

      <SchemaModal
        isOpen={editOpen}
        toggle={() => setEditOpen(false)}
        title={`Edit ${vendor.name}`}
        fields={VENDOR_FIELDS}
        initialValues={vendor}
        onSubmit={async (values) => { await salonApi.vendors.update(vendor.id, values); await load(); }}
      />
      <SchemaModal
        isOpen={Boolean(payFor)}
        toggle={() => setPayFor(null)}
        title={`Record Payment — ${vendor.name}`}
        submitLabel="Save Payment"
        fields={payFields}
        initialValues={payInitial}
        onSubmit={async (values) => {
          await salonApi.vendorPayments.create({ ...values, salonId: vendor.salonId, vendorId: vendor.id });
          await load();
        }}
      />
    </PageShell>
  );
};

export default VendorDetail;
