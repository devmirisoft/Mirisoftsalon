/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Col, Row, Spinner } from "reactstrap";
import { Button, Icon } from "@/components/Component";
import DataGrid from "@/components/salon/DataGrid";
import PageShell from "@/components/salon/PageShell";
import StatusBadge from "@/components/salon/StatusBadge";
import { salonApi } from "@/services/salonApi";
import { formatDate, formatMoney } from "@/utils/salonFormat";

const JobCartCustomerHistory = () => {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    totalPages: 1,
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    async (page = 1) => {
      setLoading(true);
      setError("");
      try {
        const [customerResponse, jobsResponse] = await Promise.all([
          salonApi.customers.get(customerId),
          salonApi.jobCarts.list({
            customerId,
            page,
            limit: 20,
          }),
        ]);
        setCustomer(customerResponse.data);
        setRows(jobsResponse.data || []);
        setPagination(
          jobsResponse.pagination || {
            page,
            totalPages: 1,
            total: 0,
          }
        );
      } catch (loadError) {
        setError(loadError.message);
      } finally {
        setLoading(false);
      }
    },
    [customerId]
  );

  useEffect(() => {
    load(1);
  }, [load]);

  return (
    <PageShell
      title={customer ? `${customer.name}'s Job Carts` : "Customer Job Carts"}
      description={
        customer
          ? `${customer.phone || "No phone"} - ${customer.customerCode}`
          : "All walk-in jobs linked to this customer"
      }
      tools={
        <Button color="light" outline onClick={() => navigate("/job-carts")}>
          <Icon name="arrow-left" /> Back to Search
        </Button>
      }
    >
      {error && <Alert color="danger">{error}</Alert>}

      {loading && !customer ? (
        <div className="text-center py-5">
          <Spinner color="primary" />
        </div>
      ) : customer ? (
        <>
          <div className="card card-bordered mb-4">
            <div className="card-inner">
              <Row className="g-3">
                <Col sm="6" lg="3">
                  <span className="text-soft d-block">Customer</span>
                  <strong>{customer.name}</strong>
                </Col>
                <Col sm="6" lg="3">
                  <span className="text-soft d-block">Phone</span>
                  <strong>{customer.phone || "—"}</strong>
                </Col>
                <Col sm="6" lg="2">
                  <span className="text-soft d-block">Total Jobs</span>
                  <strong>{pagination.total || 0}</strong>
                </Col>
                <Col sm="6" lg="2">
                  <span className="text-soft d-block">Wallet</span>
                  <strong>{formatMoney(customer.walletBalance)}</strong>
                </Col>
                <Col sm="6" lg="2">
                  <span className="text-soft d-block">Outstanding</span>
                  <strong
                    className={
                      Number(customer.outstandingAmount) > 0
                        ? "text-danger"
                        : ""
                    }
                  >
                    {formatMoney(customer.outstandingAmount)}
                  </strong>
                </Col>
              </Row>
            </div>
          </div>

          <div className="d-flex justify-content-between mb-2">
            <h5 className="mb-0">Job History</h5>
            <span className="text-soft">
              {pagination.total || 0} jobs linked to {customer.phone}
            </span>
          </div>
          <DataGrid
            loading={loading}
            rows={rows}
            emptyText="No job carts are linked to this customer."
            columns={[
              { key: "jobCartId", label: "Job Cart ID" },
              {
                key: "startTime",
                label: "Date & Time",
                render: (value) => formatDate(value, true),
              },
              {
                key: "items",
                label: "Services",
                render: (value) =>
                  value?.length
                    ? value.map((item) => item.serviceName).join(", ")
                    : "—",
              },
              {
                key: "staff",
                label: "Staff",
                render: (value) => value?.name || "Unassigned",
              },
              {
                key: "invoice",
                label: "Amount",
                render: (value) =>
                  formatMoney(value?.totalAmount ?? value?.subtotalAmount),
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
        </>
      ) : null}
    </PageShell>
  );
};

export default JobCartCustomerHistory;
