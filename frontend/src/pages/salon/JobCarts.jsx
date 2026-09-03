import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Col, Input, Label, Row } from "reactstrap";
import { Button, Icon } from "@/components/Component";
import DataGrid from "@/components/salon/DataGrid";
import PageShell from "@/components/salon/PageShell";
import StatusBadge from "@/components/salon/StatusBadge";
import { salonApi } from "@/services/salonApi";
import { formatDate } from "@/utils/salonFormat";

const timeOnly = (value) =>
  value
    ? new Intl.DateTimeFormat("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";

const JobCarts = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    totalPages: 1,
    total: 0,
  });
  const [filters, setFilters] = useState({
    status: "ACTIVE",
    search: "",
    startDate: "",
    endDate: "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    async (page = 1) => {
      setLoading(true);
      setError("");
      try {
        const search = filters.search.trim();
        const phoneDigits = search.replace(/\D/g, "");
        const normalizedSearch =
          /^[+\d\s()-]+$/.test(search) && phoneDigits.length >= 7
            ? phoneDigits
            : search;
        const response = await salonApi.jobCarts.list({
          page,
          limit: 20,
          ...(filters.status ? { status: filters.status } : {}),
          ...(normalizedSearch ? { search: normalizedSearch } : {}),
          ...(filters.startDate ? { startDate: filters.startDate } : {}),
          ...(filters.endDate ? { endDate: filters.endDate } : {}),
        });
        setRows(response.data || []);
        setPagination(response.pagination || {
          page,
          totalPages: 1,
          total: 0,
        });
      } catch (loadError) {
        setError(loadError.message);
      } finally {
        setLoading(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => load(1), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const reset = () =>
    setFilters({
      status: "ACTIVE",
      search: "",
      startDate: "",
      endDate: "",
    });

  return (
    <PageShell
      title="Job Cart"
      description="Create and manage walk-in service carts using appointments and draft invoices."
      actionLabel="New Job Cart"
      onAction={() => navigate("/job-carts/create")}
    >
      {error && <Alert color="danger">{error}</Alert>}

      <div className="card card-bordered mb-4">
        <div className="card-inner">
          <div className="d-flex flex-wrap gap-2 mb-4">
            {["ACTIVE", "COMPLETED", "CANCELLED"].map((status) => (
              <Button
                key={status}
                size="sm"
                color={filters.status === status ? "primary" : "light"}
                onClick={() =>
                  setFilters((current) => ({ ...current, status }))
                }
              >
                {status.charAt(0) + status.slice(1).toLowerCase()}
              </Button>
            ))}
            <Button
              size="sm"
              color={!filters.status ? "primary" : "light"}
              onClick={() =>
                setFilters((current) => ({ ...current, status: "" }))
              }
            >
              All
            </Button>
          </div>
          <Row className="g-3 align-items-end">
            <Col md="5">
              <Label>Search by phone or job</Label>
              <Input
                placeholder="Job cart ID, customer, phone or service"
                value={filters.search}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    search: event.target.value,
                    ...(event.target.value.trim() ? { status: "" } : {}),
                  }))
                }
              />
            </Col>
            <Col md="2">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={filters.startDate}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    startDate: event.target.value,
                  }))
                }
              />
            </Col>
            <Col md="2">
              <Label>End Date</Label>
              <Input
                type="date"
                value={filters.endDate}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    endDate: event.target.value,
                  }))
                }
              />
            </Col>
            <Col md="3" className="d-flex gap-2">
              <Button color="primary" outline onClick={() => load(1)}>
                <Icon name="search" /> Search
              </Button>
              <Button color="light" onClick={reset}>
                Reset
              </Button>
            </Col>
          </Row>
        </div>
      </div>

      <div className="d-flex justify-content-between mb-2">
        <h5 className="mb-0">Job Carts</h5>
        <span className="text-soft">{pagination.total || 0} records</span>
      </div>
      <DataGrid
        loading={loading}
        rows={rows}
        emptyText="No job carts match these filters."
        columns={[
          { key: "jobCartId", label: "Job Cart ID" },
          {
            key: "customer",
            label: "Customer Name",
            render: (value) =>
              value ? (
                <Link
                  className="fw-medium"
                  to={`/customers/${value.id}`}
                >
                  {value.name}
                </Link>
              ) : (
                "—"
              ),
          },
          {
            key: "customerPhone",
            label: "Phone No",
            render: (_value, row) =>
              row.customer ? (
                <Link to={`/customers/${row.customer.id}`}>
                  {row.customer.phone || "—"}
                </Link>
              ) : (
                "—"
              ),
          },
          {
            key: "startTime",
            label: "Date",
            render: (value) => formatDate(value),
          },
          {
            key: "start",
            label: "Start Time",
            render: (_value, row) => timeOnly(row.startTime),
          },
          {
            key: "end",
            label: "End Time",
            render: (_value, row) => timeOnly(row.endTime),
          },
          {
            key: "createdBy",
            label: "Created By",
            render: (value) => value?.name || "System",
          },
          {
            key: "editedBy",
            label: "Edited By",
            render: (value) => value?.name || "—",
          },
          {
            key: "status",
            label: "Status",
            render: (value) => <StatusBadge value={value} />,
          },
        ]}
        onView={(row) => navigate(`/job-carts/${row.id}`)}
      />

      <div className="d-flex justify-content-between align-items-center mt-3">
        <Button
          color="light"
          size="sm"
          disabled={pagination.page <= 1 || loading}
          onClick={() => load(pagination.page - 1)}
        >
          Previous
        </Button>
        <span className="text-soft">
          Page {pagination.page || 1} of {pagination.totalPages || 1}
        </span>
        <Button
          color="light"
          size="sm"
          disabled={
            pagination.page >= pagination.totalPages || loading
          }
          onClick={() => load(pagination.page + 1)}
        >
          Next
        </Button>
      </div>
    </PageShell>
  );
};

export default JobCarts;
