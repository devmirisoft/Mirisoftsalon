/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import { Link, useMatch, useNavigate } from "react-router-dom";
import { Alert, Input } from "reactstrap";
import { Button, Icon } from "@/components/Component";
import DataGrid from "@/components/salon/DataGrid";
import PageShell from "@/components/salon/PageShell";
import SchemaModal from "@/components/salon/SchemaModal";
import StatusBadge from "@/components/salon/StatusBadge";
import { VENDOR_FIELDS, canManageProducts } from "@/components/salon/ProductForms";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import { formatDate, formatMoney } from "@/utils/salonFormat";

const Vendors = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isNew = Boolean(useMatch("/admin/vendors/new"));
  const canManage = canManageProducts(user?.role);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
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

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors.filter((v) => !q || [v.name, v.contactPerson, v.phone, v.gst].some((x) => x?.toLowerCase().includes(q)));
  }, [vendors, search]);

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
      title="Vendors"
      description="Who you buy from, what you've bought and what you owe."
      actionLabel={canManage ? "Add Vendor" : undefined}
      onAction={() => navigate("/admin/vendors/new")}
    >
      {error && <Alert color="danger">{error}</Alert>}
      <DataGrid
        loading={loading}
        rows={rows}
        emptyText={vendors.length ? "No vendors match your search." : "No vendors yet."}
        header={
          <div className="card-inner border-bottom">
            <div className="form-control-wrap" style={{ maxWidth: 420 }}>
              <div className="form-icon form-icon-left"><Icon name="search" /></div>
              <Input placeholder="Search vendor, contact, phone or GST..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
        }
        columns={[
          {
            key: "name",
            label: "Vendor",
            render: (v, row) => (
              <Link to={`/admin/vendors/${row.id}`} className="fw-medium">
                {v}
                {row.contactPerson && <div className="small text-soft">{row.contactPerson}</div>}
              </Link>
            ),
          },
          { key: "phone", label: "Contact" },
          { key: "_count", label: "Products", render: (v) => v?.products || 0 },
          { key: "totalPurchased", label: "Total Purchased", render: formatMoney },
          { key: "due", label: "Due", render: (v) => <span className={Number(v) > 0 ? "text-danger fw-medium" : ""}>{formatMoney(Math.max(Number(v), 0))}</span> },
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
