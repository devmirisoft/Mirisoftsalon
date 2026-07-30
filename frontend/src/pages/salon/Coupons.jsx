/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Input } from "reactstrap";
import { Button } from "@/components/Component";
import DataGrid from "@/components/salon/DataGrid";
import PageShell from "@/components/salon/PageShell";
import SchemaModal from "@/components/salon/SchemaModal";
import ServerPagination from "@/components/salon/ServerPagination";
import StatusBadge from "@/components/salon/StatusBadge";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import { formatDate, formatMoney, minDateTimeInput } from "@/utils/salonFormat";

const couponStatus = (coupon) => {
  const now = new Date();
  if (!coupon.isActive) return "INACTIVE";
  if (new Date(coupon.validFrom) > now) return "UPCOMING";
  if (new Date(coupon.validUntil) < now) return "EXPIRED";
  if (
    coupon.maxUsageCount !== null &&
    coupon.usedCount >= coupon.maxUsageCount
  ) {
    return "USAGE_LIMIT_REACHED";
  }
  return "ACTIVE";
};

const Coupons = () => {
  const { user } = useAuth();
  const canManage = ["SUPER_ADMIN", "SALON_ADMIN"].includes(user?.role);
  const [rows, setRows] = useState([]);
  const [branches, setBranches] = useState([]);
  const [salons, setSalons] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await salonApi.coupons.list({
        page,
        limit: 25,
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(activeFilter ? { isActive: activeFilter } : {}),
      });
      setRows(response.data || []);
      setPagination(response.pagination || null);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [activeFilter, page, search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    Promise.allSettled([
      salonApi.branches.list(),
      user?.role === "SUPER_ADMIN"
        ? salonApi.salons.list()
        : Promise.resolve({ data: [] }),
    ]).then(([branchResult, salonResult]) => {
      setBranches(
        branchResult.status === "fulfilled"
          ? branchResult.value.data || []
          : []
      );
      setSalons(
        salonResult.status === "fulfilled"
          ? salonResult.value.data || []
          : []
      );
    });
  }, [user?.role]);

  const fields = useMemo(
    () => [
      ...(user?.role === "SUPER_ADMIN"
        ? [
            {
              name: "salonId",
              label: "Salon",
              type: "select",
              required: true,
              options: salons.map((salon) => ({
                value: salon.id,
                label: salon.name,
              })),
            },
          ]
        : []),
      {
        name: "branchId",
        label: "Branch",
        type: "select",
        nullable: true,
        options: branches.map((branch) => ({
          value: branch.id,
          label: branch.name,
        })),
        help: "Leave empty for a salon-wide coupon.",
      },
      { name: "couponCode", label: "Coupon code", required: true },
      { name: "name", label: "Name", nullable: true },
      {
        name: "description",
        label: "Description",
        type: "textarea",
        fullWidth: true,
        nullable: true,
      },
      {
        name: "discountPercentage",
        label: "Discount percentage",
        type: "number",
        min: 0.01,
        max: 100,
        step: "0.01",
        required: true,
      },
      {
        name: "validFrom",
        label: "Valid from",
        type: "datetime-local",
        min: minDateTimeInput(),
        required: true,
      },
      {
        name: "validUntil",
        label: "Valid until",
        type: "datetime-local",
        min: minDateTimeInput(),
        required: true,
      },
      {
        name: "maxUsageCount",
        label: "Maximum uses",
        type: "number",
        min: 1,
        step: 1,
        nullable: true,
      },
      {
        name: "minInvoiceAmount",
        label: "Minimum invoice amount",
        type: "number",
        min: 0,
        step: "0.01",
        nullable: true,
      },
    ],
    [branches, salons, user?.role]
  );

  const save = async (values) => {
    if (editing) {
      await salonApi.coupons.update(editing.id, values);
    } else {
      await salonApi.coupons.create(values);
    }
    await load();
  };

  const remove = async (coupon) => {
    if (!window.confirm(`Delete coupon ${coupon.couponCode}?`)) return;
    try {
      setError("");
      await salonApi.coupons.remove(coupon.id);
      await load();
    } catch (removeError) {
      setError(removeError.message);
    }
  };

  return (
    <PageShell
      title="Discount coupons"
      description="Create date-bound percentage coupons and control invoice eligibility."
    >
      {error && <Alert color="danger">{error}</Alert>}
      <div className="d-flex justify-content-between gap-3 flex-wrap mb-3">
        <div className="d-flex gap-2 flex-wrap">
          <Input
            value={search}
            placeholder="Search code, name or description"
            style={{ minWidth: 280 }}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          <Input
            type="select"
            value={activeFilter}
            style={{ maxWidth: 180 }}
            onChange={(event) => {
              setActiveFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All coupons</option>
            <option value="true">Active setting</option>
            <option value="false">Inactive setting</option>
          </Input>
        </div>
        {canManage && (
          <Button
            color="primary"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Add coupon
          </Button>
        )}
      </div>
      <DataGrid
        rows={rows}
        loading={loading}
        columns={[
          { key: "couponCode", label: "Code" },
          { key: "name", label: "Name" },
          {
            key: "discountPercentage",
            label: "Discount",
            render: (value) => `${Number(value)}%`,
          },
          {
            key: "validFrom",
            label: "Valid from",
            render: (value) => formatDate(value, true),
          },
          {
            key: "validUntil",
            label: "Valid until",
            render: (value) => formatDate(value, true),
          },
          {
            key: "usedCount",
            label: "Usage",
            render: (value, row) =>
              `${value} / ${row.maxUsageCount ?? "∞"}`,
          },
          {
            key: "minInvoiceAmount",
            label: "Minimum",
            render: (value) => (value === null ? "—" : formatMoney(value)),
          },
          {
            key: "status",
            label: "Status",
            render: (_value, row) => (
              <StatusBadge value={couponStatus(row)} />
            ),
          },
        ]}
        renderActions={
          canManage
            ? (row) => (
                <>
                  <Button
                    size="sm"
                    color="primary"
                    outline
                    onClick={() => {
                      setEditing(row);
                      setFormOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    color={row.isActive ? "warning" : "success"}
                    outline
                    className="ms-1"
                    onClick={async () => {
                      try {
                        await salonApi.coupons.setStatus(
                          row.id,
                          !row.isActive
                        );
                        await load();
                      } catch (statusError) {
                        setError(statusError.message);
                      }
                    }}
                  >
                    {row.isActive ? "Deactivate" : "Activate"}
                  </Button>
                  <Button
                    size="sm"
                    color="danger"
                    outline
                    className="ms-1"
                    onClick={() => remove(row)}
                  >
                    Delete
                  </Button>
                </>
              )
            : undefined
        }
      />
      <ServerPagination pagination={pagination} onPage={setPage} />
      <SchemaModal
        isOpen={formOpen}
        toggle={() => setFormOpen((open) => !open)}
        title={`${editing ? "Edit" : "Add"} coupon`}
        fields={fields}
        initialValues={editing}
        onSubmit={save}
      />
    </PageShell>
  );
};

export default Coupons;
