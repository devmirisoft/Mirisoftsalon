import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Col, Input, Label, Row } from "reactstrap";
import { Button, Icon } from "@/components/Component";
import DataGrid from "@/components/salon/DataGrid";
import PageShell from "@/components/salon/PageShell";
import ServerPagination from "@/components/salon/ServerPagination";
import StatusBadge from "@/components/salon/StatusBadge";
import { salonApi } from "@/services/salonApi";
import { formatDate } from "@/utils/salonFormat";

const STATUS_TABS = [
  { value: "ACTIVE", label: "Active" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "", label: "All" },
];

const timeOnly = (value) =>
  value
    ? new Intl.DateTimeFormat("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";

const durationLabel = (minutes) =>
  minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : `${minutes}m`;

// An active cart has no bill yet, so its calculated end time would read as a
// promise the counter never made: show it only once the bill exists, with how
// far the billing time ran over (red) or under (green) that estimate.
// ponytail: updatedAt is the confirm time because a completed cart is locked
// against further edits; store a billedAt if that ever stops holding.
const endTimeCell = (row) => {
  if (row.status !== "COMPLETED" || !row.endTime) return "";
  const billedAt = row.updatedAt ? new Date(row.updatedAt) : null;
  const drift = billedAt
    ? Math.round((billedAt - new Date(row.endTime)) / 60000)
    : 0;
  return (
    <>
      {timeOnly(row.endTime)}
      {drift !== 0 && (
        <span
          className={`ms-1 ${drift > 0 ? "text-danger" : "text-success"}`}
        >
          ({drift > 0 ? "+" : "-"}
          {durationLabel(Math.abs(drift))})
        </span>
      )}
    </>
  );
};

const JobCarts = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    totalPages: 1,
    total: 0,
    limit: 10,
  });
  const [limit, setLimit] = useState(10);
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
          limit,
          ...(filters.status ? { status: filters.status } : {}),
          ...(normalizedSearch ? { search: normalizedSearch } : {}),
          ...(filters.startDate ? { startDate: filters.startDate } : {}),
          ...(filters.endDate ? { endDate: filters.endDate } : {}),
        });
        setRows(response.data || []);
        setPagination(
          response.pagination || { page, totalPages: 1, total: 0, limit }
        );
      } catch (loadError) {
        setError(loadError.message);
      } finally {
        setLoading(false);
      }
    },
    [filters, limit]
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

  const firstOnPage = ((pagination.page || 1) - 1) * (pagination.limit || limit);

  return (
    <PageShell
      className="jobcarts-page page-tight"
      title="Job Cart"
      description="Create and manage walk-in service carts using appointments and draft invoices."
      actionLabel="New Job Cart"
      onAction={() => navigate("/job-carts/create")}
    >
      {error && <Alert color="danger">{error}</Alert>}

      <div className="card card-bordered jc-panel mb-4">
        <div className="card-inner">
          <div className="jc-tabs">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value || "ALL"}
                type="button"
                className={`jc-tab jc-tab-${tab.value.toLowerCase()} ${
                  filters.status === tab.value ? "is-active" : ""
                }`}
                onClick={() =>
                  setFilters((current) => ({ ...current, status: tab.value }))
                }
              >
                {tab.label}
              </button>
            ))}
          </div>
          <Row className="g-3 align-items-end">
            <Col md="5">
              <Label className="jc-label">Search by phone or job</Label>
              <div className="cust-field">
                <Icon name="search" className="cust-field-icon" />
                <Input
                  className="cust-input"
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
              </div>
            </Col>
            <Col md="2">
              <Label className="jc-label">Start Date</Label>
              <div className="cust-field">
                <Icon name="calendar" className="cust-field-icon" />
                <Input
                  className="cust-input"
                  type="date"
                  value={filters.startDate}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      startDate: event.target.value,
                    }))
                  }
                />
              </div>
            </Col>
            <Col md="2">
              <Label className="jc-label">End Date</Label>
              <div className="cust-field">
                <Icon name="calendar" className="cust-field-icon" />
                <Input
                  className="cust-input"
                  type="date"
                  value={filters.endDate}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      endDate: event.target.value,
                    }))
                  }
                />
              </div>
            </Col>
            <Col md="3" className="d-flex gap-2">
              <Button
                color="primary"
                className="jc-btn-primary"
                onClick={() => load(1)}
              >
                <Icon name="search" /> <span>Search</span>
              </Button>
              <Button color="light" className="jc-btn-ghost" onClick={reset}>
                Reset
              </Button>
            </Col>
          </Row>
        </div>
      </div>

      <DataGrid
        loading={loading}
        rows={rows}
        emptyText="No job carts match these filters."
        header={
          <div className="jc-grid-head">
            <h6>
              <Icon name="file-docs" />
              <span>Job Carts</span>
            </h6>
            <span className="jc-grid-count">
              {pagination.total || 0} records
            </span>
          </div>
        }
        columns={[
          {
            key: "rowIndex",
            label: "#",
            render: (_value, _row, index) => firstOnPage + index + 1,
          },
          {
            key: "jobCartId",
            label: "Job Cart ID",
            render: (value, row) => (
              <Link className="jc-id" to={`/job-carts/${row.id}`}>
                {value}
              </Link>
            ),
          },
          {
            key: "customer",
            label: "Customer Name",
            render: (value) =>
              value ? (
                <Link
                  className="jc-link fw-medium"
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
                <Link className="jc-link" to={`/customers/${row.customer.id}`}>
                  {row.customer.phone || "—"}
                </Link>
              ) : (
                "—"
              ),
          },
          {
            key: "branch",
            label: "Branch",
            render: (value) => value?.name || "—",
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
            render: (_value, row) => endTimeCell(row),
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
        renderActions={(row) => (
          <>
            <Button
              size="sm"
              color="light"
              onClick={() => navigate(`/job-carts/${row.id}/view`)}
            >
              <Icon name="file-text" /> View job cart
            </Button>
            {row.status === "ACTIVE" && (
              <Button
                size="sm"
                color="success"
                onClick={() => navigate(`/job-carts/${row.id}?bill=1`)}
              >
                <Icon name="file-plus" /> Make bill
              </Button>
            )}
          </>
        )}
      />

      <ServerPagination
        pagination={pagination}
        onPage={(page) => load(page)}
        onLimit={setLimit}
      />
    </PageShell>
  );
};

export default JobCarts;
