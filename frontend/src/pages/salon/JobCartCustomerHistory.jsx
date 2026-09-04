/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Col, Row, Spinner } from "reactstrap";
import { Button, Icon } from "@/components/Component";
import DataGrid from "@/components/salon/DataGrid";
import PageShell from "@/components/salon/PageShell";
import StatusBadge from "@/components/salon/StatusBadge";
import { salonApi } from "@/services/salonApi";
import { formatDate, formatMoney, labelize } from "@/utils/salonFormat";

const DASH = "—";

// One dot per included use: filled for consumed, hollow for what is left.
// Reserved uses (held by an open job cart) read as spent so the customer is
// never shown a balance the till will refuse.
const usageDotCounts = (included, used = 0, reserved = 0) => {
  const total = Math.max(Number(included) || 0, 0);
  const spent = Math.min(
    Math.max((Number(used) || 0) + (Number(reserved) || 0), 0),
    total
  );
  return { total, spent };
};

const UsageDots = ({ included, used = 0, reserved = 0 }) => {
  const { total, spent } = usageDotCounts(included, used, reserved);
  if (!total) return <span className="text-soft">{DASH}</span>;
  return (
    <span className="d-inline-flex flex-wrap align-items-center gap-1">
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          title={index < spent ? "Used" : "Remaining"}
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            display: "inline-block",
            background: index < spent ? "#816bff" : "#dbdfea",
          }}
        />
      ))}
      <span className="text-soft ms-1 small">
        {spent}/{total}
      </span>
    </span>
  );
};

const Stat = ({ label, value, tone }) => (
  <Col sm="6" lg="3">
    <span className="text-soft d-block">{label}</span>
    <strong className={tone}>{value}</strong>
  </Col>
);

const JobCartCustomerHistory = () => {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    totalPages: 1,
    total: 0,
  });
  const [appointmentRows, setAppointmentRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    async (page = 1) => {
      setLoading(true);
      setError("");
      try {
        const [customerResponse, summaryResponse, jobsResponse, appointmentsResponse] =
          await Promise.all([
            salonApi.customers.get(customerId),
            salonApi.jobCarts.customerSummary({ customerId }).catch(() => null),
            salonApi.jobCarts.list({
              customerId,
              page,
              limit: 20,
            }),
            salonApi.appointments.list({ customerId }),
          ]);
        setCustomer(customerResponse.data);
        setSummary(summaryResponse?.data || null);
        setRows(jobsResponse.data || []);
        setPagination(
          jobsResponse.pagination || {
            page,
            totalPages: 1,
            total: 0,
          }
        );
        // Booked appointments only — walk-in job carts are the same table
        // and already shown in the Job History section above.
        setAppointmentRows(
          (appointmentsResponse.data || []).filter(
            (appointment) => !appointment.walkInJobCart
          )
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

  const products = summary?.productPurchases || [];

  return (
    <PageShell
      title={customer ? `${customer.name}'s Profile` : "Customer Profile"}
      description={
        customer
          ? `${customer.phone || "No phone"} - ${customer.customerCode}`
          : "Full job and appointment history for this customer"
      }
      tools={
        <Button color="light" outline onClick={() => navigate("/customers")}>
          <Icon name="arrow-left" /> Back to Customers
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
              <h6 className="overline-title text-primary mb-3">Contact</h6>
              <Row className="g-3">
                <Stat label="Name" value={customer.name} />
                <Stat label="Phone" value={customer.phone || DASH} />
                <Stat label="Email" value={customer.email || DASH} />
                <Stat label="Customer code" value={customer.customerCode} />
                <Stat label="GST" value={customer.gst || DASH} />
                <Stat
                  label="Date of birth"
                  value={customer.dob ? formatDate(customer.dob) : DASH}
                />
                <Stat
                  label="Anniversary"
                  value={
                    customer.anniversaryDate
                      ? formatDate(customer.anniversaryDate)
                      : DASH
                  }
                />
                <Stat
                  label="Status"
                  value={<StatusBadge value={customer.status} />}
                />
                <Stat label="Branch" value={customer.branch?.name || DASH} />
                <Stat
                  label="Customer since"
                  value={formatDate(customer.createdAt)}
                />
                {customer.customNotes && (
                  <Col xs="12">
                    <span className="text-soft d-block">Notes</span>
                    <strong>{customer.customNotes}</strong>
                  </Col>
                )}
              </Row>
            </div>
          </div>

          <div className="card card-bordered mb-4">
            <div className="card-inner">
              <h6 className="overline-title text-primary mb-3">
                Visits &amp; spending
              </h6>
              <Row className="g-3">
                <Stat
                  label="Total visits"
                  value={summary?.totalVisits ?? pagination.total ?? 0}
                />
                <Stat
                  label="First visit"
                  value={
                    summary?.firstVisitDate
                      ? formatDate(summary.firstVisitDate)
                      : DASH
                  }
                />
                <Stat
                  label="Last visit"
                  value={
                    summary?.lastVisitDate
                      ? formatDate(summary.lastVisitDate)
                      : DASH
                  }
                />
                <Stat
                  label="Preferred staff"
                  value={
                    summary?.preferredStaff
                      ? `${summary.preferredStaff.staffName} (${summary.preferredStaff.serviceCount} services)`
                      : "Not known"
                  }
                />
                <Stat
                  label="Total spend"
                  value={formatMoney(summary?.totalSpend)}
                />
                <Stat
                  label="Average per bill"
                  value={formatMoney(summary?.averageSpend)}
                />
                <Stat
                  label="Total paid"
                  value={formatMoney(summary?.totalPaid)}
                />
                <Stat label="Bills" value={summary?.invoiceCount ?? 0} />
                <Stat
                  label="Wallet"
                  value={formatMoney(customer.walletBalance)}
                />
                <Stat
                  label="Outstanding"
                  value={formatMoney(customer.outstandingAmount)}
                  tone={
                    Number(customer.outstandingAmount) > 0 ? "text-danger" : ""
                  }
                />
                <Stat
                  label="Loyalty points"
                  value={customer.loyaltyPoints ?? 0}
                />
              </Row>
            </div>
          </div>

          <div className="card card-bordered mb-4">
            <div className="card-inner">
              <h6 className="overline-title text-primary mb-3">Membership</h6>
              <Row className="g-3">
                <Stat
                  label="Plan"
                  value={
                    summary?.membershipName ||
                    customer.membership?.name ||
                    "None"
                  }
                />
                <Stat
                  label="Status"
                  value={
                    summary?.membershipStatus ? (
                      <StatusBadge value={summary.membershipStatus} />
                    ) : (
                      DASH
                    )
                  }
                />
                <Stat
                  label="Started"
                  value={
                    summary?.membershipStartsAt
                      ? formatDate(summary.membershipStartsAt)
                      : DASH
                  }
                />
                <Stat
                  label="Expires"
                  value={
                    summary?.membershipExpiresAt
                      ? formatDate(summary.membershipExpiresAt)
                      : DASH
                  }
                />
              </Row>
            </div>
          </div>

          <div className="card card-bordered mb-4">
            <div className="card-inner">
              <h6 className="overline-title text-primary mb-3">
                Packages ({summary?.activePackages?.length || 0} active)
              </h6>
              {summary?.activePackages?.length ? (
                summary.activePackages.map((item) => (
                  <div
                    key={item.customerPackageId}
                    className="border rounded p-3 mb-2"
                  >
                    <div className="d-flex justify-content-between flex-wrap gap-2 mb-2">
                      <strong>{item.packageName}</strong>
                      <span className="text-soft small">
                        Valid to {formatDate(item.validUntil)}
                        {item.soldByStaffName
                          ? ` • sold by ${item.soldByStaffName}`
                          : ""}
                      </span>
                    </div>
                    {(item.serviceBalances || []).map((balance) => (
                      <div
                        key={balance.balanceId}
                        className="d-flex justify-content-between align-items-center flex-wrap gap-2 py-1"
                      >
                        <span>{balance.serviceName}</span>
                        <UsageDots
                          included={balance.includedQuantity}
                          used={balance.usedQuantity}
                          reserved={balance.reservedQuantity}
                        />
                      </div>
                    ))}
                  </div>
                ))
              ) : (
                <span className="text-soft">No active packages.</span>
              )}
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

          <div className="d-flex justify-content-between mb-2 mt-5">
            <h5 className="mb-0">Appointment History</h5>
            <span className="text-soft">
              {appointmentRows.length} booked appointments
            </span>
          </div>
          <DataGrid
            loading={loading}
            rows={appointmentRows}
            emptyText="No booked appointments for this customer."
            columns={[
              { key: "appointmentCode", label: "Appointment ID" },
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
                    ? value.map((item) => item.service?.name || item.serviceName).join(", ")
                    : "—",
              },
              {
                key: "staff",
                label: "Staff",
                render: (value) => value?.name || "Unassigned",
              },
              {
                key: "status",
                label: "Status",
                render: (value) => <StatusBadge value={value} />,
              },
            ]}
            onView={() => navigate("/appointments")}
          />

          <div className="d-flex justify-content-between mb-2 mt-5">
            <h5 className="mb-0">Products Bought</h5>
            <span className="text-soft">{products.length} purchases</span>
          </div>
          <DataGrid
            loading={loading}
            rows={products}
            emptyText="This customer has not bought any products."
            columns={[
              { key: "reference", label: "Bill / Sale" },
              {
                key: "date",
                label: "Date",
                render: (value) => formatDate(value),
              },
              { key: "productName", label: "Product" },
              { key: "quantity", label: "Qty" },
              {
                key: "unitPrice",
                label: "Unit Price",
                render: (value) => formatMoney(value),
              },
              {
                key: "totalAmount",
                label: "Total",
                render: (value) => formatMoney(value),
              },
              {
                key: "soldByStaffName",
                label: "Sold By",
                render: (value) => value || DASH,
              },
              {
                key: "source",
                label: "Source",
                render: (value) => labelize(value),
              },
            ]}
          />

          <div className="d-flex justify-content-between mb-2 mt-5">
            <h5 className="mb-0">Recent Bills</h5>
            <span className="text-soft">
              {summary?.recentInvoices?.length || 0} invoices
            </span>
          </div>
          <DataGrid
            loading={loading}
            rows={summary?.recentInvoices || []}
            emptyText="No invoices for this customer."
            columns={[
              { key: "invoiceCode", label: "Invoice" },
              {
                key: "date",
                label: "Date",
                render: (value) => formatDate(value),
              },
              {
                key: "totalAmount",
                label: "Total",
                render: (value) => formatMoney(value),
              },
              {
                key: "paidAmount",
                label: "Paid",
                render: (value) => formatMoney(value),
              },
              {
                key: "balanceDue",
                label: "Balance",
                render: (value) => formatMoney(value),
              },
              {
                key: "status",
                label: "Status",
                render: (value) => <StatusBadge value={value} />,
              },
            ]}
          />
        </>
      ) : null}
    </PageShell>
  );
};

export default JobCartCustomerHistory;
