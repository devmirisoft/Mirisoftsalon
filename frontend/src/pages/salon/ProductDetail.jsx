/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Alert,
  Col,
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
  Row,
  UncontrolledDropdown,
} from "reactstrap";
import { Button, Icon } from "@/components/Component";
import DataGrid from "@/components/salon/DataGrid";
import PageShell from "@/components/salon/PageShell";
import {
  AddStockModal,
  AdjustStockModal,
  InfoList,
  KpiCard,
  ProductDrawer,
  RouteTabs,
  StockBadge,
  canManageProducts,
  formatQty,
  isContainerContent,
  movementDelta,
  movementLabel,
  useProductRefs,
} from "@/components/salon/ProductForms";
import ProductInventoryPanel from "@/components/salon/ProductInventoryPanel";
import { formatAmount, locationLabel } from "@/components/salon/InventoryModals";
import { LoaderOne } from "@/components/ui/loader";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import { formatDate, formatMoney, labelize } from "@/utils/salonFormat";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "inventory", label: "Inventory" },
  { key: "sales", label: "Sales" },
  { key: "stock", label: "Stock History" },
  { key: "purchases", label: "Purchases" },
];

const ProductDetail = () => {
  const { id, tab: tabParam } = useParams();
  const tab = TABS.some((t) => t.key === tabParam) ? tabParam : "overview";
  const { user } = useAuth();
  const canManage = canManageProducts(user?.role);
  const [refs, reloadRefs] = useProductRefs(user?.role);
  const [product, setProduct] = useState(null);
  const [activity, setActivity] = useState({ sales: [], purchases: [], productGstRate: 0 });
  const [movements, setMovements] = useState([]);
  const [inventory, setInventory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null); // "edit" | "add" | "adjust"

  const load = async () => {
    try {
      const [p, a, m, inv] = await Promise.all([
        salonApi.products.get(id),
        salonApi.products.activity(id),
        salonApi.stockMovements.byProduct(id),
        salonApi.inventory.product(id),
      ]);
      setProduct(p.data);
      setActivity(a.data);
      setMovements(m.data || []);
      setInventory(inv.data);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setLoading(true); load(); }, [id]);

  const stats = useMemo(() => {
    const soldQty = activity.sales.reduce((s, x) => s + x.quantity, 0);
    const revenue = activity.sales.reduce((s, x) => s + x.netAmount, 0);
    const purchasedQty = activity.purchases.reduce((s, x) => s + x.quantity, 0);
    const adjustments = movements.filter((m) => !["RETAIL_SALE"].includes(m.type) && m.referenceType !== "PRODUCT_PURCHASE").length;
    // ponytail: profit uses today's cost price, not the cost at time of sale; switch to per-sale cost if purchase prices swing a lot.
    const profit = revenue - soldQty * Number(product?.costPrice || 0);
    return { soldQty, revenue, purchasedQty, adjustments, profit, avgPrice: soldQty ? revenue / soldQty : 0 };
  }, [activity, movements, product]);

  // Movement referenceId -> human code + link, using the sales/purchases we already loaded.
  const references = useMemo(() => {
    const map = new Map();
    activity.purchases.forEach((p) => map.set(p.purchaseId, { code: p.purchaseCode }));
    activity.sales.forEach((s) => map.set(s.referenceId, {
      code: s.reference,
      to: s.source === "INVOICE" ? `/billing/invoices/${s.referenceId}` : null,
    }));
    return map;
  }, [activity]);

  if (loading) {
    return (
      <PageShell title="Product">
        <div className="d-flex justify-content-center py-5 text-primary"><LoaderOne label="Loading product" /></div>
      </PageShell>
    );
  }
  if (!product) {
    return (
      <PageShell title="Product">
        <Alert color="danger">{error || "Product not found."}</Alert>
        <Link to="/admin/products"><Icon name="arrow-left" /> Back to products</Link>
      </PageShell>
    );
  }

  const cost = Number(product.costPrice);
  const price = Number(product.sellingPrice);
  const lastPurchase = activity.purchases[0];

  return (
    <PageShell
      title={product.name}
      description={
        <>
          {product.sku ? `SKU: ${product.sku} · ` : ""}In Stock: <strong>{formatQty(product.currentStock)} {product.unit}</strong>{" "}
          <StockBadge product={product} />
        </>
      }
      tools={
        <>
          <Link to="/admin/products" className="btn btn-light"><Icon name="arrow-left" /><span>Products</span></Link>
          {canManage && (
            <>
              <Button color="primary" outline onClick={() => setOpen("edit")}><Icon name="edit" /><span>Edit Product</span></Button>
              <Button color="primary" onClick={() => setOpen("add")}><Icon name="plus" /><span>Add Stock</span></Button>
              <UncontrolledDropdown>
                <DropdownToggle color="light">More <Icon name="chevron-down" /></DropdownToggle>
                <DropdownMenu end>
                  <DropdownItem onClick={() => setOpen("adjust")}>Adjust Stock</DropdownItem>
                  <DropdownItem
                    onClick={async () => {
                      try { await salonApi.products.setStatus(product.id, !product.status); await load(); }
                      catch (statusError) { setError(statusError.message); }
                    }}
                  >
                    {product.status ? "Deactivate" : "Activate"}
                  </DropdownItem>
                </DropdownMenu>
              </UncontrolledDropdown>
            </>
          )}
        </>
      }
    >
      {error && <Alert color="danger">{error}</Alert>}

      <Row className="g-3 mb-4">
        <Col xs="6" lg="3"><KpiCard label="Stock (all locations)" value={`${formatQty(product.currentStock)}`} /></Col>
        <Col xs="6" lg="3"><KpiCard label="Units Sold" value={formatQty(stats.soldQty)} /></Col>
        <Col xs="6" lg="3"><KpiCard label="Sales Value" value={formatMoney(stats.revenue)} /></Col>
        <Col xs="6" lg="3"><KpiCard label="Profit" value={formatMoney(stats.profit)} tone={stats.profit < 0 ? "danger" : "success"} /></Col>
      </Row>

      <RouteTabs base={`/admin/products/${product.id}`} tabs={TABS} active={tab} />

      {tab === "overview" && (
        <Row className="g-3">
          <Col md="6">
            <InfoList title="Product Information" items={[
              ["Product name", product.name],
              ["Brand", product.brand?.name || "Generic"],
              ["Category", product.category],
              ["SKU", product.sku],
              ["Barcode", product.barcode],
              ["HSN code", product.hsnCode],
              ["Unit", product.unit],
              ["GST", `${activity.productGstRate}% (salon product rate)`],
              ["Branch", product.branch?.name || "All branches"],
            ]} />
          </Col>
          <Col md="6">
            <InfoList title="Pricing" items={[
              ["Purchase price", formatMoney(cost)],
              ["Selling price", formatMoney(price)],
              ["Profit / unit", formatMoney(price - cost)],
              ["Margin", price > 0 ? `${(((price - cost) / price) * 100).toFixed(1)}%` : "—"],
            ]} />
          </Col>
          <Col md="6">
            <InfoList title="Inventory" items={[
              ["Stock (all locations)", `${formatQty(product.currentStock)} ${product.unit}`],
              ["Low-stock threshold", formatQty(product.lowStockAlert)],
              ["Total purchased", formatQty(stats.purchasedQty)],
              ["Total sold", formatQty(stats.soldQty)],
              ["Adjustments", stats.adjustments],
            ]} />
          </Col>
          <Col md="6">
            <InfoList title="Vendor" items={[
              ["Preferred vendor", product.vendor?.name],
              ["Vendor phone", refs.vendors.find((v) => v.id === product.vendorId)?.phone],
              ["Last purchase", lastPurchase ? `${formatDate(lastPurchase.date)} · ${lastPurchase.vendorName || "—"}` : null],
              ["Last purchase price", lastPurchase ? formatMoney(lastPurchase.unitCost) : null],
            ]} />
          </Col>
        </Row>
      )}

      {tab === "inventory" && inventory && (
        <ProductInventoryPanel inventory={inventory} role={user?.role} onChanged={load} />
      )}

      {tab === "sales" && (
        <>
          <Row className="g-3 mb-3">
            <Col xs="6" lg="3"><KpiCard label="Units Sold" value={formatQty(stats.soldQty)} /></Col>
            <Col xs="6" lg="3"><KpiCard label="Sales Revenue" value={formatMoney(stats.revenue)} /></Col>
            <Col xs="6" lg="3"><KpiCard label="Avg. Selling Price" value={formatMoney(stats.avgPrice)} /></Col>
            <Col xs="6" lg="3"><KpiCard label="Profit" value={formatMoney(stats.profit)} /></Col>
          </Row>
          <DataGrid
            rows={activity.sales}
            emptyText="This product hasn't been sold yet."
            columns={[
              { key: "date", label: "Date", render: (v) => formatDate(v) },
              { key: "reference", label: "Invoice", render: (v, row) => row.source === "INVOICE" ? <Link to={`/billing/invoices/${row.referenceId}`}>{v}</Link> : <span>{v} <span className="text-soft small">(counter)</span></span> },
              { key: "customerName", label: "Customer" },
              { key: "customerPhone", label: "Phone", render: (v) => v || "—" },
              { key: "quantity", label: "Qty", render: formatQty },
              { key: "unitPrice", label: "Price", render: formatMoney },
              { key: "discount", label: "Discount", render: formatMoney },
              { key: "netAmount", label: "Net Amount", render: formatMoney },
              { key: "staffName", label: "Staff" },
            ]}
          />
        </>
      )}

      {tab === "stock" && (
        <DataGrid
          rows={movements}
          emptyText="No stock activity yet."
          header={<div className="card-inner border-bottom">Current Stock: <strong>{formatQty(product.currentStock)} {product.unit}</strong></div>}
          columns={[
            { key: "createdAt", label: "Date", render: (v) => formatDate(v, true) },
            { key: "type", label: "Activity", render: (_, m) => <>{movementLabel(m)}{m.reason && m.reason !== "Opening stock" && <div className="small text-soft">{m.reason}</div>}{m.note && <div className="small text-soft">{m.note}</div>}</> },
            {
              key: "location",
              label: "Where",
              render: (v, m) =>
                m.type === "TRANSFER"
                  ? `${m.branchId || !m.toBranchId ? "" : "Salon "}${locationLabel(v)} → ${locationLabel(m.toLocation)}`
                  : <>{locationLabel(v)}{m.container && <div className="small text-soft">{m.container.code}</div>}</>,
            },
            {
              key: "referenceId",
              label: "Reference",
              render: (v, m) => {
                const ref = references.get(v);
                if (ref?.to) return <Link to={ref.to}>{ref.code}</Link>;
                if (ref) return ref.code;
                if (m.appointment) {
                  return (
                    <>
                      {m.appointment.walkInJobCart
                        ? <Link to={`/job-carts/${m.appointment.id}/view`}>{m.appointment.appointmentCode}</Link>
                        : m.appointment.appointmentCode}
                      {m.service && <div className="small text-soft">{m.service.name}</div>}
                    </>
                  );
                }
                if (m.referenceType === "JOB_CART" && v) return <Link to={`/job-carts/${v}/view`}>Job cart</Link>;
                return m.referenceType ? labelize(m.referenceType) : "—";
              },
            },
            {
              key: "quantity",
              label: "Quantity",
              render: (v, m) => {
                // Use inside an opened container is in its unit (ml), not product units.
                if (isContainerContent(m)) {
                  const delta = Number(m.stockAfter) - Number(m.stockBefore);
                  return <span className={delta < 0 ? "text-danger" : "text-success"}>{delta > 0 ? "+" : "-"}{formatAmount(Math.abs(delta), m.unit || m.container?.unit)}</span>;
                }
                const delta = movementDelta(m);
                if (m.type === "TRANSFER" || delta === 0) return `${formatQty(v)} ${(m.unit || product.unit).toLowerCase()}`;
                return <span className={delta > 0 ? "text-success" : "text-danger"}>{delta > 0 ? "+" : "-"}{formatQty(Math.abs(delta))}</span>;
              },
            },
            {
              key: "stockAfter",
              label: "Balance",
              render: (v, m) => (isContainerContent(m) ? `${formatAmount(v, m.unit || m.container?.unit)} left` : formatQty(v)),
            },
            {
              key: "staff",
              label: "Staff",
              render: (v, m) => (v || m.receivedByStaff ? <>{v?.name || "—"}{m.receivedByStaff && <div className="small text-soft">Received: {m.receivedByStaff.name}</div>}</> : "—"),
            },
            { key: "createdBy", label: "Recorded by", render: (v) => v?.name || "System" },
          ]}
        />
      )}

      {tab === "purchases" && (
        <DataGrid
          rows={activity.purchases}
          emptyText="No purchases recorded for this product."
          columns={[
            { key: "date", label: "Date", render: (v) => formatDate(v) },
            { key: "purchaseCode", label: "Purchase #", render: (v, row) => <>{v}{row.invoiceNo && <div className="small text-soft">Inv: {row.invoiceNo}</div>}</> },
            { key: "vendorName", label: "Vendor" },
            { key: "quantity", label: "Qty", render: formatQty },
            { key: "unitCost", label: "Rate", render: formatMoney },
            { key: "totalCost", label: "Total", render: formatMoney },
            { key: "paymentStatus", label: "Payment", render: labelize },
          ]}
        />
      )}

      <ProductDrawer
        isOpen={open === "edit"}
        toggle={() => setOpen(null)}
        product={product}
        refs={refs}
        reloadRefs={reloadRefs}
        role={user?.role}
        onSaved={load}
      />
      <AddStockModal isOpen={open === "add"} toggle={() => setOpen(null)} product={product} vendors={refs.vendors} onSaved={load} />
      <AdjustStockModal isOpen={open === "adjust"} toggle={() => setOpen(null)} product={product} onSaved={load} />
    </PageShell>
  );
};

export default ProductDetail;
