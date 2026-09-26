/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import { Alert, Col, Input, Row, Spinner } from "reactstrap";
import { Link } from "react-router-dom";
import { Doughnut } from "react-chartjs-2";
import { ArcElement, Chart, Tooltip } from "chart.js";
import { Button, Icon } from "@/components/Component";
import PageShell from "@/components/salon/PageShell";
import { CardTitle, RankTable } from "@/pages/salon/SalonReport";
import { salonApi } from "@/services/salonApi";
import { formatDate, formatMoney, labelize } from "@/utils/salonFormat";

Chart.register(ArcElement, Tooltip);

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

/** Round icon, headline number, label and a soft footnote — the dashboard tile. */
const StatCard = ({ icon, color, value, label, note }) => (
  <div className="card card-bordered dash-card h-100">
    <div className="card-inner d-flex dash-gap-3 align-items-start">
      <div className={`dash-icon bg-${color}-dim text-${color}`}>
        <Icon name={icon} />
      </div>
      <div>
        <div className="text-soft fs-13px">{label}</div>
        <div className="fs-4 fw-bold lh-sm mt-1">{value}</div>
        {note && <div className="fs-12px text-soft mt-1">{note}</div>}
      </div>
    </div>
  </div>
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
    <div className="card card-bordered dash-card mb-4">
      <div className="card-inner pb-0">
        <CardTitle icon="scissor" title="Service wise record" />
      </div>
      <div className="card-inner pt-3">
        <div className="table-responsive" style={{ maxHeight: 440, overflowY: "auto" }}>
          <table className="table mb-0">
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
                  <td colSpan={6} className="text-center text-soft py-4">
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
    </div>
  );
};

const SalesReport = () => {
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

  const services = data?.services ?? {};
  const serviceBuckets = [services.appointments, services.jobCarts, services.counter];
  const servicesSold = serviceBuckets.reduce((sum, row) => sum + (row?.count ?? 0), 0);
  const serviceAmount = serviceBuckets.reduce((sum, row) => sum + (row?.amount ?? 0), 0);
  const totalSales =
    serviceAmount +
    (data?.products?.amount ?? 0) +
    (data?.packages?.amount ?? 0) +
    (data?.memberships?.amount ?? 0);
  const serviceSales = data?.serviceSales ?? [];
  const paymentMethods = data?.paymentMethods ?? [];
  const collected = paymentMethods.reduce((sum, row) => sum + row.amount, 0);

  return (
    <PageShell
      className="sales-report"
      title="Sales Report"
      description="Track your sales, services and revenue performance."
      tools={
        <div className="d-flex align-items-start dash-gap-2 flex-wrap">
          <div>
            <Input
              type="select"
              aria-label="Period"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
            >
              {PERIODS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Input>
            {data?.range?.from && (
              <div className="text-soft fs-11px mt-1">
                Showing {data.range.from} to {data.range.to} ({data.range.timezone})
              </div>
            )}
          </div>
          {period === "custom" && (
            <>
              <Input
                type="date"
                aria-label="From"
                style={{ width: "auto" }}
                value={dates.from}
                onChange={(event) =>
                  setDates((current) => ({ ...current, from: event.target.value }))
                }
              />
              <Input
                type="date"
                aria-label="To"
                style={{ width: "auto" }}
                value={dates.to}
                onChange={(event) =>
                  setDates((current) => ({ ...current, to: event.target.value }))
                }
              />
            </>
          )}
          <Button color="primary" onClick={load}>
            Apply
          </Button>
        </div>
      }
    >
      {error && <Alert color="danger">{error}</Alert>}

      {loading ? (
        <div className="text-center py-5">
          <Spinner color="primary" />
        </div>
      ) : (
        data && (
          <>
            <div className="dash-stats mb-4">
              <StatCard
                icon="cart"
                color="success"
                label="Total sales"
                value={formatMoney(totalSales)}
                note="Services, products, packages & memberships"
              />
              <StatCard
                icon="file-docs"
                color="purple"
                label="Service invoices"
                value={serviceSales.length}
                note="Bills with at least one service"
              />
              <StatCard
                icon="scissor"
                color="danger"
                label="Services sold"
                value={servicesSold}
                note={
                  `${services.appointments?.count ?? 0} appointments · ` +
                  `${services.jobCarts?.count ?? 0} job carts` +
                  (services.counter?.count ? ` · ${services.counter.count} counter` : "")
                }
              />
              <StatCard
                icon="users"
                color="info"
                label="Memberships sold"
                value={data.memberships?.count ?? 0}
                note={formatMoney(data.memberships?.amount ?? 0)}
              />
            </div>

            <div className="card card-bordered dash-card mb-4">
              <div className="card-inner pb-0">
                <div className="dash-card-head">
                  <CardTitle icon="clock" title="Recent sales" />
                  <span className="text-soft fs-12px">Invoices with services, newest first</span>
                </div>
              </div>
              <div className="card-inner pt-3">
                <div className="table-responsive" style={{ maxHeight: 440, overflowY: "auto" }}>
                  <table className="table mb-0">
                    <thead>
                      <tr>
                        <th>Date &amp; time</th>
                        <th>Invoice</th>
                        <th>Payment mode</th>
                        <th>Created by</th>
                        <th>Edited by</th>
                        <th className="text-end">Amount</th>
                        <th className="text-end">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {serviceSales.map((sale) => (
                        <tr key={sale.id}>
                          <td className="text-nowrap">{formatDate(sale.invoiceDate, true)}</td>
                          <td>
                            <Link to={`/billing/invoices/${sale.id}`}>{sale.invoiceCode}</Link>
                            <div className="fs-12px text-soft">{sale.customerName}</div>
                          </td>
                          <td>
                            {sale.paymentMethods.length
                              ? sale.paymentMethods.map(labelize).join(", ")
                              : "Unpaid"}
                          </td>
                          <td>{sale.createdBy ?? "-"}</td>
                          <td>{sale.editedBy ?? "-"}</td>
                          <td className="text-end fw-medium">{formatMoney(sale.amount)}</td>
                          <td className="text-end">
                            <Link
                              to={`/billing/invoices/${sale.id}`}
                              className="btn btn-sm btn-outline-primary"
                            >
                              <Icon name="eye" />
                              <span>View</span>
                            </Link>
                          </td>
                        </tr>
                      ))}
                      {!serviceSales.length && (
                        <tr>
                          <td colSpan={7} className="text-center text-soft py-4">
                            No service sales for this period
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <ServiceWiseRecord rows={data.serviceWise ?? []} />

            <Row className="g-gs mb-4">
              {[
                ["Other sales", "Products", "bag", "warning", data.products],
                ["Packages", "Packages", "package", "success", data.packages],
                ["Memberships", "Memberships", "heart", "danger", data.memberships],
              ].map(([title, unit, icon, color, row]) => (
                <Col md="4" key={title}>
                  <StatCard
                    icon={icon}
                    color={color}
                    label={title}
                    value={row?.count ?? 0}
                    note={`${unit} · ${formatMoney(row?.amount ?? 0)}`}
                  />
                </Col>
              ))}
            </Row>

            <Row className="g-gs mb-4">
              <Col lg="6">
                <RankTable icon="trophy" title="Top services" rows={data.topServices} />
              </Col>
              <Col lg="6">
                <RankTable icon="box" title="Top products" rows={data.topProducts} />
              </Col>
            </Row>

            <Row className="g-gs mb-4">
              <Col xl="4" lg="6">
                <RankTable icon="gift" title="Top packages" rows={data.topPackages} countLabel="Sold" />
              </Col>
              <Col xl="4" lg="6">
                <div className="card card-bordered dash-card h-100">
                  <div className="card-inner">
                    <div className="mb-3">
                      <CardTitle icon="wallet" title="Payment methods" />
                    </div>
                    {collected ? (
                      <div className="d-flex align-items-center justify-content-center flex-wrap dash-gap-3">
                        <div className="dash-donut">
                          <Doughnut
                            data={{
                              labels: paymentMethods.map((row) => labelize(row.method)),
                              datasets: [
                                {
                                  data: paymentMethods.map((row) => row.amount),
                                  backgroundColor: paymentMethods.map(
                                    (_, index) => PALETTE[index % PALETTE.length]
                                  ),
                                  borderWidth: 2,
                                },
                              ],
                            }}
                            options={{
                              cutout: "68%",
                              maintainAspectRatio: false,
                              plugins: {
                                legend: { display: false },
                                tooltip: {
                                  callbacks: {
                                    label: (item) => `${item.label}: ${formatMoney(item.raw)}`,
                                  },
                                },
                              },
                            }}
                          />
                          <div className="dash-donut-center">
                            <div className="fw-bold">{formatMoney(collected)}</div>
                            <div className="text-soft fs-11px">Collected</div>
                          </div>
                        </div>
                        <ul className="list-plain flex-grow-1 mb-0 fs-12px">
                          {paymentMethods.map((row, index) => (
                            <li key={row.method} className="d-flex align-items-center dash-gap-2 py-1">
                              <span
                                className="dash-dot"
                                style={{ background: PALETTE[index % PALETTE.length] }}
                              />
                              <span className="flex-grow-1">{labelize(row.method)}</span>
                              <span className="text-soft">
                                {((row.amount / collected) * 100).toFixed(1)}%
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="text-soft">No payments for this period</div>
                    )}
                  </div>
                </div>
              </Col>
              <Col xl="4" lg="12">
                <RankTable icon="users" title="Top memberships" rows={data.topMemberships} countLabel="Sold" />
              </Col>
            </Row>

            <RankTable icon="user-list" title="Top customers" rows={data.topCustomers} countLabel="Payments" />
          </>
        )
      )}
    </PageShell>
  );
};

export default SalesReport;
