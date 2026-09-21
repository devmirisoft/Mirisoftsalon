/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import { Alert, Col, Input, Label, Row, Spinner } from "reactstrap";
import { Link } from "react-router-dom";
import { Pie } from "react-chartjs-2";
import { ArcElement, Chart, Legend, Tooltip } from "chart.js";
import { Button, Icon } from "@/components/Component";
import PageShell from "@/components/salon/PageShell";
import { RankTable } from "@/pages/salon/SalonReport";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import { allowsRole, formatDate, formatMoney, labelize } from "@/utils/salonFormat";

Chart.register(ArcElement, Legend, Tooltip);

const PALETTE = [
  "#212e6b", "#1ee0ac", "#f4bd0e", "#e85347", "#816bff",
  "#09c2de", "#ff63a5", "#8091a7", "#20c997", "#c4cefe",
];

const PERIODS = [
  ["day", "Today"],
  ["week", "This week"],
  ["month", "This month"],
  ["quarter", "Quarter (3 months)"],
  ["halfyear", "Half year (6 months)"],
  ["year", "Year (12 months)"],
  ["custom", "Custom range"],
];

const StatCard = ({ label, icon, color, row }) => (
  <Col sm="6" xl="4">
    <div className="card card-bordered h-100">
      <div className="card-inner d-flex align-items-center gap-3">
        <div className={`user-avatar bg-${color}-dim text-${color}`}>
          <Icon name={icon} />
        </div>
        <div>
          <div className="fs-2 fw-bold">{row?.count ?? 0}</div>
          <div className="text-soft">{label}</div>
          <div className="fs-12px text-soft">{formatMoney(row?.amount ?? 0)}</div>
        </div>
      </div>
    </div>
  </Col>
);

/**
 * Totals for the service-wise record. Mirrored by
 * frontend/src/pages/salon/__checks__/serviceWiseTotals.check.mjs.
 */
const serviceWiseTotals = (rows) =>
  rows.reduce(
    (totals, row) => ({
      units: totals.units + (row.count ?? 0),
      amount: totals.amount + (row.amount ?? 0),
    }),
    { units: 0, amount: 0 }
  );

/** What one service averaged per unit, and its share of service revenue. */
const serviceWiseRow = (row, totalAmount) => ({
  average: row.count ? row.amount / row.count : 0,
  share: totalAmount ? (row.amount / totalAmount) * 100 : 0,
});

/**
 * Every service billed in the window, ranked by revenue. "Top services" below
 * is the ten-row highlight; this is the full record the counter reconciles
 * against.
 */
const ServiceWiseRecord = ({ rows }) => {
  const totals = serviceWiseTotals(rows);
  return (
    <div className="card card-bordered mb-4">
      <div className="table-responsive" style={{ maxHeight: 440, overflowY: "auto" }}>
        <table className="table table-hover mb-0">
          <thead>
            <tr>
              <th>#</th>
              <th>Service</th>
              <th className="text-end">Qty sold</th>
              <th className="text-end">Revenue</th>
              <th className="text-end">Avg price</th>
              <th className="text-end">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const { average, share } = serviceWiseRow(row, totals.amount);
              return (
                <tr key={`${row.name}-${index}`}>
                  <td>{index + 1}</td>
                  <td>{row.name}</td>
                  <td className="text-end">{row.count}</td>
                  <td className="text-end">{formatMoney(row.amount)}</td>
                  <td className="text-end">{formatMoney(average)}</td>
                  <td className="text-end">{share.toFixed(1)}%</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="text-center text-soft">
                  No services billed for this period
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="fw-bold">
                <td colSpan={2}>{rows.length} services</td>
                <td className="text-end">{totals.units}</td>
                <td className="text-end">{formatMoney(totals.amount)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

const SalesReport = () => {
  const { user } = useAuth();
  // Invoice cancel is admin-only on the backend.
  const canDelete = allowsRole(["SUPER_ADMIN", "SALON_ADMIN"], user?.role);
  const [period, setPeriod] = useState("month");
  const [dates, setDates] = useState({ from: "", to: "" });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await salonApi.reports.salesDashboard({
        period,
        ...(period === "custom" && dates.from ? { from: dates.from } : {}),
        ...(period === "custom" && dates.to ? { to: dates.to } : {}),
      });
      setData(response.data);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  // Presets reload themselves; a custom range waits for the Apply button.
  useEffect(() => {
    if (period !== "custom") load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  // "Delete" cancels the invoice: that reverses stock, packages and balances,
  // and keeps the invoice number on record for GST.
  const deleteSale = async (sale) => {
    if (!window.confirm(`Delete invoice ${sale.invoiceCode}? This cancels the invoice.`)) return;
    try {
      await salonApi.invoices.cancel(sale.id);
      await load();
    } catch (deleteError) {
      setError(deleteError.message);
    }
  };

  const services = data?.services ?? {};
  const paymentMethods = data?.paymentMethods ?? [];

  return (
    <PageShell
      title="Sales report"
      description="How many services, products, packages and memberships were sold."
    >
      {error && <Alert color="danger">{error}</Alert>}

      <div className="card card-bordered mb-4">
        <div className="card-inner">
          <Row className="g-3 align-items-end">
            <Col md="3">
              <Label>Period</Label>
              <Input
                type="select"
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
              >
                {PERIODS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Input>
            </Col>
            {period === "custom" && (
              <>
                <Col md="2">
                  <Label>From</Label>
                  <Input
                    type="date"
                    value={dates.from}
                    onChange={(event) =>
                      setDates((current) => ({ ...current, from: event.target.value }))
                    }
                  />
                </Col>
                <Col md="2">
                  <Label>To</Label>
                  <Input
                    type="date"
                    value={dates.to}
                    onChange={(event) =>
                      setDates((current) => ({ ...current, to: event.target.value }))
                    }
                  />
                </Col>
              </>
            )}
            <Col md="2">
              <Button color="primary" outline onClick={load}>
                Apply
              </Button>
            </Col>
          </Row>
          {data?.range?.from && (
            <div className="text-soft fs-12px mt-2">
              Showing {data.range.from} to {data.range.to} ({data.range.timezone})
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <Spinner color="primary" />
      ) : (
        data && (
          <>
            <h6 className="overline-title text-soft mb-2">Services sold</h6>
            <Row className="g-gs mb-4">
              <StatCard label="In appointments" icon="calender-date" color="purple" row={services.appointments} />
              <StatCard label="In job carts" icon="cart" color="info" row={services.jobCarts} />
              {services.counter?.count > 0 && (
                <StatCard label="Counter bills" icon="file-docs" color="gray" row={services.counter} />
              )}
            </Row>
            <h6 className="overline-title text-soft mb-2">Service sales</h6>
            <div className="card card-bordered mb-4">
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Invoice</th>
                      <th className="text-end">Cost</th>
                      <th>Payment mode</th>
                      <th>Created by</th>
                      <th>Edited by</th>
                      <th className="text-end">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.serviceSales ?? []).map((sale) => (
                      <tr key={sale.id}>
                        <td>{formatDate(sale.invoiceDate, true)}</td>
                        <td>
                          <Link to={`/billing/invoices/${sale.id}`}>{sale.invoiceCode}</Link>
                          <div className="fs-12px text-soft">{sale.customerName}</div>
                        </td>
                        <td className="text-end">{formatMoney(sale.amount)}</td>
                        <td>
                          {sale.paymentMethods.length
                            ? sale.paymentMethods.map(labelize).join(", ")
                            : "Unpaid"}
                        </td>
                        <td>{sale.createdBy ?? "-"}</td>
                        <td>{sale.editedBy ?? "-"}</td>
                        <td className="text-end">
                          {canDelete && (
                            <Button size="sm" color="danger" outline onClick={() => deleteSale(sale)}>
                              <Icon name="trash" />
                              <span>Delete</span>
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!data.serviceSales?.length && (
                      <tr>
                        <td colSpan={7} className="text-center text-soft">
                          No service sales for this period
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <h6 className="overline-title text-soft mb-2">Service wise record</h6>
            <ServiceWiseRecord rows={data.serviceWise ?? []} />

            <h6 className="overline-title text-soft mb-2">Other sales</h6>
            <Row className="g-gs">
              <StatCard label="Products" icon="bag" color="warning" row={data.products} />
              <StatCard label="Packages" icon="package" color="success" row={data.packages} />
              <StatCard label="Memberships" icon="heart" color="danger" row={data.memberships} />
            </Row>

            <h6 className="overline-title text-soft mt-4 mb-2">Top sellers</h6>
            <Row className="g-4 mb-4">
              <Col lg="6">
                <RankTable title="Top services" rows={data.topServices} />
              </Col>
              <Col lg="6">
                <RankTable title="Top products" rows={data.topProducts} />
              </Col>
              <Col lg="6">
                <RankTable title="Top packages" rows={data.topPackages} countLabel="Sold" />
              </Col>
              <Col lg="6">
                <RankTable title="Top memberships" rows={data.topMemberships} countLabel="Sold" />
              </Col>
            </Row>

            <Row className="g-4">
              <Col lg="5">
                <div className="card card-bordered h-100">
                  <div className="card-inner">
                    <h6 className="title mb-2">Payment methods</h6>
                    {paymentMethods.length ? (
                      <div style={{ height: 280 }}>
                        <Pie
                          data={{
                            labels: paymentMethods.map((row) => labelize(row.method)),
                            datasets: [
                              {
                                data: paymentMethods.map((row) => row.amount),
                                backgroundColor: paymentMethods.map(
                                  (_, index) => PALETTE[index % PALETTE.length]
                                ),
                              },
                            ],
                          }}
                          options={{
                            maintainAspectRatio: false,
                            plugins: {
                              legend: { labels: { boxWidth: 12, padding: 16 } },
                              tooltip: {
                                callbacks: {
                                  label: (item) => `${item.label}: ${formatMoney(item.raw)}`,
                                },
                              },
                            },
                          }}
                        />
                      </div>
                    ) : (
                      <div className="text-soft">No payments for this period</div>
                    )}
                  </div>
                </div>
              </Col>
              <Col lg="7">
                <RankTable title="Top customers" rows={data.topCustomers} countLabel="Payments" />
              </Col>
            </Row>
          </>
        )
      )}
    </PageShell>
  );
};

export default SalesReport;
