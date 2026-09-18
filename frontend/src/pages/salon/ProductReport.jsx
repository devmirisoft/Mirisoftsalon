import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Input } from "reactstrap";
import { Icon } from "@/components/Component";
import DataGrid from "@/components/salon/DataGrid";
import PageShell from "@/components/salon/PageShell";
import { StockBadge, formatQty } from "@/components/salon/ProductForms";
import { salonApi } from "@/services/salonApi";
import { formatMoney } from "@/utils/salonFormat";

const ProductReport = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    salonApi.products.list()
      .then((response) => setProducts(response.data || []))
      .catch((loadError) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term
      ? products.filter((p) => [p.name, p.category, p.hsnCode].some((v) => v?.toLowerCase().includes(term)))
      : products;
  }, [products, q]);

  return (
    <PageShell title="Product report" description="Every product with its price, units sold and how often it was sold.">
      {error && <Alert color="danger">{error}</Alert>}
      <DataGrid
        loading={loading}
        rows={rows}
        emptyText="No products found."
        header={
          <div className="card-inner border-bottom">
            <Input placeholder="Search product, category or HSN..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        }
        columns={[
          { key: "name", label: "Product Name" },
          { key: "category", label: "Category", render: (v) => v || "—" },
          { key: "sellingPrice", label: "Unit Price", render: formatMoney },
          { key: "soldQty", label: "Units Sold", render: formatQty },
          { key: "saleCount", label: "Times in a Sale" },
          { key: "hsnCode", label: "HSN Code", render: (v) => v || "—" },
          { key: "status", label: "Status", render: (_, row) => <StockBadge product={row} /> },
          {
            key: "id",
            label: "Action",
            render: (id) => (
              <Link to={`/admin/products/${id}/sales`} className="btn btn-sm btn-outline-primary">
                <Icon name="eye" /><span>Details</span>
              </Link>
            ),
          },
        ]}
      />
    </PageShell>
  );
};

export default ProductReport;
