/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import { Link, useMatch, useNavigate } from "react-router-dom";
import { Alert, Col, Input, Row } from "reactstrap";
import { Button, Icon } from "@/components/Component";
import DataGrid from "@/components/salon/DataGrid";
import PageShell from "@/components/salon/PageShell";
import ServerPagination from "@/components/salon/ServerPagination";
import {
  AddStockModal,
  AdjustStockModal,
  KpiCard,
  ProductDrawer,
  StockBadge,
  canManageProducts,
  formatQty,
  stockStatus,
  useProductRefs,
} from "@/components/salon/ProductForms";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import { allowsRole, formatMoney } from "@/utils/salonFormat";

const PAGE_SIZE = 10;
const STOCK_TONE = { low: "text-warning", out: "text-danger" };

const Products = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canManage = canManageProducts(user?.role);
  const isNew = Boolean(useMatch("/admin/products/new"));
  const [refs, reloadRefs] = useProductRefs(user?.role);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ q: "", category: "", brand: "", stock: "" });
  const [page, setPage] = useState(1);
  const [editProduct, setEditProduct] = useState(null);
  const [stockModal, setStockModal] = useState({ kind: null, product: null });

  const load = async () => {
    setLoading(true);
    try {
      setProducts((await salonApi.products.list()).data || []);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(),
    [products]
  );
  const brands = useMemo(
    () => [...new Set(products.map((p) => p.brand?.name).filter(Boolean))].sort(),
    [products]
  );

  const summary = useMemo(() => {
    const active = products.filter((p) => p.status);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return {
      total: products.length,
      newThisMonth: products.filter((p) => new Date(p.createdAt) >= monthStart).length,
      value: active.reduce((sum, p) => sum + Math.max(Number(p.currentStock), 0) * Number(p.costPrice), 0),
      low: active.filter((p) => stockStatus(p).key === "low").length,
      out: active.filter((p) => stockStatus(p).key === "out").length,
    };
  }, [products]);

  const rows = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return products.filter((p) =>
      (!q || [p.name, p.sku, p.barcode, p.brand?.name].some((v) => v?.toLowerCase().includes(q))) &&
      (!filters.category || p.category === filters.category) &&
      (!filters.brand || p.brand?.name === filters.brand) &&
      (!filters.stock || (filters.stock === "inactive" ? !p.status : p.status && stockStatus(p).key === filters.stock))
    );
  }, [products, filters]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const setFilter = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };

  const toggleStatus = async (product) => {
    try {
      await salonApi.products.setStatus(product.id, !product.status);
      await load();
    } catch (statusError) {
      setError(statusError.message);
    }
  };

  return (
    <PageShell
      title="Products"
      description="Manage your retail products, pricing, stock and sales."
      actionLabel={canManage ? "Add Product" : undefined}
      onAction={() => navigate("/admin/products/new")}
      tools={
        <>
          {allowsRole(["SALON_ADMIN", "RECEPTIONIST"], user?.role) && (
            <Link to="/admin/retail-products" className="btn btn-light"><Icon name="cart" /><span>Counter Sale</span></Link>
          )}
          {canManage && <Link to="/admin/product-brands" className="btn btn-light"><Icon name="tag" /><span>Brands</span></Link>}
        </>
      }
    >
      {error && <Alert color="danger">{error}</Alert>}

      <Row className="g-3 mb-4">
        <Col xs="6" lg="3">
          <KpiCard
            icon="package"
            label="Total Products"
            value={summary.total}
            hint={summary.newThisMonth > 0 && <span className="text-success"><Icon name="arrow-up" /> +{summary.newThisMonth} this month</span>}
          />
        </Col>
        <Col xs="6" lg="3"><KpiCard icon="coins" iconColor="success" label="Stock Value" value={formatMoney(summary.value)} hint="Current inventory value" /></Col>
        <Col xs="6" lg="3"><KpiCard icon="alert" iconColor="warning" label="Low Stock" value={summary.low} hint="Needs attention" /></Col>
        <Col xs="6" lg="3"><KpiCard icon="cross-circle" iconColor="danger" label="Out of Stock" value={summary.out} hint="Reorder soon" /></Col>
      </Row>

      <DataGrid
        loading={loading}
        rows={pageRows}
        emptyText={products.length ? "No products match these filters." : "No products yet. Add your first product to get started."}
        header={
          <div className="card-inner border-bottom">
            <Row className="g-2">
              <Col md="6">
                <div className="form-control-wrap">
                  <div className="form-icon form-icon-left"><Icon name="search" /></div>
                  <Input placeholder="Search product, SKU or barcode..." value={filters.q} onChange={setFilter("q")} />
                </div>
              </Col>
              <Col xs="4" md="2">
                <Input type="select" value={filters.category} onChange={setFilter("category")}>
                  <option value="">All Categories</option>
                  {categories.map((c) => <option key={c}>{c}</option>)}
                </Input>
              </Col>
              <Col xs="4" md="2">
                <Input type="select" value={filters.brand} onChange={setFilter("brand")}>
                  <option value="">All Brands</option>
                  {brands.map((b) => <option key={b}>{b}</option>)}
                </Input>
              </Col>
              <Col xs="4" md="2">
                <Input type="select" value={filters.stock} onChange={setFilter("stock")}>
                  <option value="">Stock Status</option>
                  <option value="in">In Stock</option>
                  <option value="low">Low Stock</option>
                  <option value="out">Out of Stock</option>
                  <option value="inactive">Inactive</option>
                </Input>
              </Col>
            </Row>
          </div>
        }
        columns={[
          {
            key: "name",
            label: "Product",
            render: (v, row) => <Link to={`/admin/products/${row.id}`} className="fw-bold text-dark">{v}</Link>,
          },
          { key: "sku", label: "SKU", render: (v) => <span className="text-soft">{v || "—"}</span> },
          { key: "category", label: "Category" },
          { key: "brand", label: "Brand", render: (v) => v?.name || "Generic" },
          {
            key: "currentStock",
            label: "Stock",
            render: (v, row) => (
              <span className={`fw-bold ${row.status ? STOCK_TONE[stockStatus(row).key] || "" : ""}`}>
                {formatQty(v)} <small className="fw-normal text-soft">{row.unit}</small>
              </span>
            ),
          },
          { key: "costPrice", label: "Cost Price", render: formatMoney },
          { key: "sellingPrice", label: "Selling Price", render: formatMoney },
          { key: "soldQty", label: "Units Sold", render: formatQty },
          { key: "revenue", label: "Revenue", render: formatMoney },
          { key: "status", label: "Status", render: (_, row) => <StockBadge product={row} /> },
        ]}
        renderActions={(row) => (
          <>
            <Button onClick={() => navigate(`/admin/products/${row.id}`)}><Icon name="eye" />View Details</Button>
            {canManage && <Button onClick={() => setEditProduct(row)}><Icon name="edit" />Edit Product</Button>}
            {canManage && <Button onClick={() => setStockModal({ kind: "add", product: row })}><Icon name="plus-circle" />Add Stock</Button>}
            {canManage && <Button onClick={() => setStockModal({ kind: "adjust", product: row })}><Icon name="exchange" />Adjust Stock</Button>}
            <Button onClick={() => navigate(`/admin/products/${row.id}/sales`)}><Icon name="bar-chart" />View Sales</Button>
            {canManage && <Button onClick={() => toggleStatus(row)}><Icon name={row.status ? "pause" : "play"} />{row.status ? "Deactivate" : "Activate"}</Button>}
          </>
        )}
      />
      <ServerPagination
        pagination={{ page: currentPage, totalPages, total: rows.length, limit: PAGE_SIZE }}
        onPage={setPage}
      />

      <ProductDrawer
        isOpen={isNew || Boolean(editProduct)}
        toggle={() => { setEditProduct(null); if (isNew) navigate("/admin/products"); }}
        product={isNew ? null : editProduct}
        refs={refs}
        reloadRefs={reloadRefs}
        categories={categories}
        role={user?.role}
        onSaved={load}
      />
      <AddStockModal
        isOpen={stockModal.kind === "add"}
        toggle={() => setStockModal({ kind: null, product: null })}
        product={stockModal.product}
        vendors={refs.vendors}
        onSaved={load}
      />
      <AdjustStockModal
        isOpen={stockModal.kind === "adjust"}
        toggle={() => setStockModal({ kind: null, product: null })}
        product={stockModal.product}
        onSaved={load}
      />
    </PageShell>
  );
};

export default Products;
