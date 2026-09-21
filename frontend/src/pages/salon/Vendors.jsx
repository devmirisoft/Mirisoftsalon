/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from "react";
import { Link, useMatch, useNavigate } from "react-router-dom";
import { Alert, Input } from "reactstrap";
import { Button, Icon } from "@/components/Component";
import DataGrid from "@/components/salon/DataGrid";
import PageShell from "@/components/salon/PageShell";
import SchemaModal from "@/components/salon/SchemaModal";
import ServerPagination from "@/components/salon/ServerPagination";
import StatusBadge from "@/components/salon/StatusBadge";
import { VENDOR_FIELDS, canManageProducts } from "@/components/salon/ProductForms";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import { formatDate, formatMoney } from "@/utils/salonFormat";

const PAGE_SIZE = 10;
const categoriesOf = (vendor) => vendor.products?.map((p) => p.category) || [];

const StatCard = ({ icon, tone, label, value, hint }) => (
  <div className="vd-stat">
    <span className={`vd-stat-icon bg-${tone}-dim text-${tone}`}><Icon name={icon} /></span>
    <div>
      <div className="vd-stat-label">{label}</div>
      <div className="vd-stat-value">{value}</div>
      <div className="vd-stat-hint">{hint}</div>
    </div>
  </div>
);

const Vendors = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isNew = Boolean(useMatch("/admin/vendors/new"));
  const canManage = canManageProducts(user?.role);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ q: "", status: "", category: "" });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    try {
      setVendors((await salonApi.vendors.list()).data || []);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const categories = useMemo(() => [...new Set(vendors.flatMap(categoriesOf))].sort(), [vendors]);

  const summary = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return {
      active: vendors.filter((v) => v.status).length,
      newThisMonth: vendors.filter((v) => new Date(v.createdAt) >= monthStart).length,
      purchased: vendors.reduce((sum, v) => sum + Number(v.totalPurchased || 0), 0),
      paid: vendors.reduce((sum, v) => sum + Number(v.totalPaid || 0), 0),
      due: vendors.reduce((sum, v) => sum + Math.max(Number(v.due || 0), 0), 0),
    };
  }, [vendors]);

  const rows = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return vendors.filter((v) =>
      (!q || [v.name, v.contactPerson, v.phone, v.email, v.gst].some((x) => x?.toLowerCase().includes(q))) &&
      (!filters.status || String(v.status) === filters.status) &&
      (!filters.category || categoriesOf(v).includes(filters.category))
    );
  }, [vendors, filters]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const setFilter = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };

  const closeModal = () => {
    setEditing(null);
    if (isNew) navigate("/admin/vendors");
  };

  const toggleStatus = async (vendor) => {
    try {
      await salonApi.vendors.setStatus(vendor.id, !vendor.status);
      await load();
    } catch (statusError) {
      setError(statusError.message);
    }
  };

  return (
    <PageShell
      className="vendors-page"
      title="Vendors"
      description="Manage your vendors, purchase history and payments"
      actionLabel={canManage ? "Add Vendor" : undefined}
      onAction={() => navigate("/admin/vendors/new")}
    >
      {error && <Alert color="danger">{error}</Alert>}

      <div className="vd-stats">
        <StatCard
          icon="users"
          tone="primary"
          label="Total Vendors"
          value={vendors.length}
          hint={summary.newThisMonth > 0
            ? <span className="text-success"><Icon name="arrow-up" /> +{summary.newThisMonth} this month</span>
            : `${summary.active} active`}
        />
        <StatCard icon="file-text" tone="success" label="Total Purchases" value={formatMoney(summary.purchased)} hint="From all vendors" />
        <StatCard icon="wallet" tone="info" label="Total Payments" value={formatMoney(summary.paid)} hint="Paid to vendors" />
        <StatCard icon="clock" tone="danger" label="Amount Due" value={formatMoney(summary.due)} hint="Pending payments" />
      </div>

      <DataGrid
        loading={loading}
        rows={pageRows}
        emptyText={vendors.length ? "No vendors match these filters." : "No vendors yet."}
        header={
          <div className="vd-toolbar">
            <div className="form-control-wrap vd-search">
              <div className="form-icon form-icon-left"><Icon name="search" /></div>
              <Input placeholder="Search vendor name, contact or GST..." value={filters.q} onChange={setFilter("q")} />
            </div>
            <Input type="select" className="vd-select" value={filters.status} onChange={setFilter("status")}>
              <option value="">All Status</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </Input>
            <Input type="select" className="vd-select" value={filters.category} onChange={setFilter("category")}>
              <option value="">All Categories</option>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </Input>
          </div>
        }
        footer={
          <ServerPagination
            pagination={{ page: currentPage, totalPages, total: rows.length, limit: PAGE_SIZE }}
            onPage={setPage}
          />
        }
        columns={[
          {
            key: "name",
            label: "Vendor Name",
            render: (v, row) => (
              <>
                <Link to={`/admin/vendors/${row.id}`} className="vd-name">{v}</Link>
                {categoriesOf(row).length > 0 && <div className="vd-sub">{categoriesOf(row).join(", ")}</div>}
              </>
            ),
          },
          { key: "contactPerson", label: "Contact Person" },
          { key: "phone", label: "Phone" },
          { key: "email", label: "Email" },
          { key: "_count", label: "Products", render: (v) => v?.products || 0 },
          { key: "totalPurchased", label: "Total Purchased", render: formatMoney },
          { key: "due", label: "Amount Due", render: (v) => <span className={Number(v) > 0 ? "text-danger fw-medium" : ""}>{formatMoney(Math.max(Number(v), 0))}</span> },
          { key: "lastPurchaseAt", label: "Last Purchase", render: (v) => (v ? formatDate(v) : "—") },
          { key: "status", label: "Status", render: (v) => <StatusBadge value={v} /> },
        ]}
        renderActions={(row) => (
          <>
            <Button onClick={() => navigate(`/admin/vendors/${row.id}`)}><Icon name="eye" />View</Button>
            {canManage && <Button onClick={() => setEditing(row)}><Icon name="edit" />Edit</Button>}
            {canManage && row.status && <Button onClick={() => navigate(`/admin/inventory/receive?vendorId=${row.id}`)}><Icon name="cart" />Create Purchase</Button>}
            {canManage && <Button onClick={() => toggleStatus(row)}><Icon name={row.status ? "pause" : "play"} />{row.status ? "Deactivate" : "Activate"}</Button>}
          </>
        )}
      />

      <SchemaModal
        isOpen={isNew || Boolean(editing)}
        toggle={closeModal}
        title={editing ? `Edit ${editing.name}` : "Add Vendor"}
        submitLabel={editing ? "Save" : "Add Vendor"}
        fields={VENDOR_FIELDS}
        initialValues={editing || undefined}
        onSubmit={async (values) => {
          if (editing) await salonApi.vendors.update(editing.id, values);
          else await salonApi.vendors.create(values);
          await load();
        }}
      />
    </PageShell>
  );
};

export default Vendors;
