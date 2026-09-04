/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import { Alert, Col, Input, Label, Row, Spinner } from "reactstrap";
import { Bar, Line, Pie } from "react-chartjs-2";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { Button } from "@/components/Component";
import PageShell from "@/components/salon/PageShell";
import ReportExportButtons from "@/components/salon/ReportExportButtons";
import { salonApi } from "@/services/salonApi";
import { formatMoney } from "@/utils/salonFormat";

Chart.register(
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip
);

const PERIODS = [
  ["day", "Today"],
  ["week", "This week"],
  ["month", "This month"],
  ["custom", "Custom range"],
];

const CUSTOMER_TYPES = [
  ["all", "All"],
  ["appointment", "Appointment"],
  ["jobcard", "Job card"],
];

const PALETTE = [
  "#6576ff", "#1ee0ac", "#f4bd0e", "#e85347", "#816bff",
  "#09c2de", "#ff63a5", "#8091a7", "#20c997", "#c4cefe",
];

const chartOptions = (legend = false) => ({
  maintainAspectRatio: false,
  plugins: { legend: { display: legend, labels: { boxWidth: 12, padding: 16 } } },
});

const Panel = ({ title, subtitle, children, height = 280 }) => (
  <div className="card card-bordered h-100">
    <div className="card-inner">
      <h6 className="title mb-1">{title}</h6>
      {subtitle && <div className="text-soft fs-12px mb-2">{subtitle}</div>}
      <div style={{ height }}>{children}</div>
    </div>
  </div>
);

const Empty = () => (
  <div className="d-flex align-items-center justify-content-center h-100 text-soft">
    No data for this period
  </div>
);

/** Horizontal bars, highest first — the rank view for "top N" lists. */
const RankChart = ({ rows, valueKey = "amount", money = true }) => {
  if (!rows?.length) return <Empty />;
  return (
    <Bar
      data={{
        labels: rows.map((row) => row.name ?? row.method),
        datasets: [
          {
            data: rows.map((row) => row[valueKey]),
            backgroundColor: rows.map((_, index) => PALETTE[index % PALETTE.length]),
            borderRadius: 4,
          },
        ],
      }}
      options={{
        ...chartOptions(),
        indexAxis: "y",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) =>
                money ? formatMoney(item.raw) : `${item.raw}`,
            },
          },
        },
      }}
    />
  );
};

const StatCard = ({ label, value, tone }) => (
  <Col md="3" sm="6">
    <div className="card card-bordered h-100">
      <div className="card-inner">
        <div className="text-soft fs-12px mb-1">{label}</div>
        <h5 className={tone ? `text-${tone}` : ""}>{value}</h5>
      </div>
    </div>
  </Col>
);

const RankTable = ({ title, rows, countLabel = "Qty" }) => (
  <div className="card card-bordered h-100">
    <div className="card-inner">
      <h6 className="title mb-2">{title}</h6>
      {rows?.length ? (
        <table className="table table-sm mb-0">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th className="text-end">{countLabel}</th>
              <th className="text-end">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.name}-${index}`}>
                <td>{index + 1}</td>
                <td>{row.name}</td>
                <td className="text-end">{row.count}</td>
                <td className="text-end">{formatMoney(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="text-soft">No data for this period</div>
      )}
    </div>
  </div>
);

const SalonReport = () => {
  const [period, setPeriod] = useState("month");
  const [customerType, setCustomerType] = useState("all");
  const [dates, setDates] = useState({ from: "", to: "" });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const query = {
    period,
    customerType,
    ...(period === "custom" && dates.from ? { from: dates.from } : {}),
    ...(period === "custom" && dates.to ? { to: dates.to } : {}),
  };

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await salonApi.reports.salonReport(query);
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
  }, [period, customerType]);

  const totals = data?.totals;
  const trend = data?.trend ?? [];
  const rankings = data?.rankings ?? {};

  return (
    <PageShell
      title="Salon report"
      description="Payments, sales, staff, services and memberships across the selected period."
      tools={<ReportExportButtons reportType="salon-report" filters={query} />}
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
            <Col md="3">
              <Label>Customers</Label>
              <Input
                type="select"
                value={customerType}
                onChange={(event) => setCustomerType(event.target.value)}
              >
                {CUSTOMER_TYPES.map(([value, label]) => (
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
            <Row className="g-4 mb-4">
              <StatCard label="Service payments" value={formatMoney(totals.servicePayments)} tone="success" />
              <StatCard label="Product sales" value={formatMoney(totals.productSalesTotal)} tone="success" />
              <StatCard label="Retail sales" value={formatMoney(totals.retailSalesTotal)} tone="success" />
              <StatCard label="Sale revenue" value={formatMoney(totals.saleRevenue)} tone="success" />
              <StatCard label="Product purchases" value={formatMoney(totals.productPurchaseCost)} tone="danger" />
              <StatCard label="Expenses" value={formatMoney(totals.expensesTotal)} tone="danger" />
              <StatCard label="New customers" value={data.customers.newCustomers} />
              <StatCard
                label="Net earnings"
                value={formatMoney(totals.netEarnings)}
                tone={totals.netEarnings < 0 ? "danger" : "success"}
              />
            </Row>

            <Row className="g-4 mb-4">
              <Col lg="8">
                <Panel title="Revenue and expenses" subtitle="Daily totals over the period">
                  {trend.length ? (
                    <Line
                      data={{
                        labels: trend.map((row) => row.date),
                        datasets: [
                          {
                            label: "Revenue",
                            data: trend.map((row) => row.revenue),
                            borderColor: PALETTE[0],
                            backgroundColor: "rgba(101,118,255,.15)",
                            fill: true,
                            tension: 0.3,
                          },
                          {
                            label: "Expenses",
                            data: trend.map((row) => row.expenses),
                            borderColor: PALETTE[3],
                            backgroundColor: "rgba(232,83,71,.12)",
                            fill: true,
                            tension: 0.3,
                          },
                        ],
                      }}
                      options={chartOptions(true)}
                    />
                  ) : (
                    <Empty />
                  )}
                </Panel>
              </Col>
              <Col lg="4">
                <Panel title="Payment methods" subtitle="Share of money collected">
                  {data.paymentMethods.length ? (
                    <Pie
                      data={{
                        labels: data.paymentMethods.map((row) => row.method),
                        datasets: [
                          {
                            data: data.paymentMethods.map((row) => row.amount),
                            backgroundColor: data.paymentMethods.map(
                              (_, index) => PALETTE[index % PALETTE.length]
                            ),
                          },
                        ],
                      }}
                      options={chartOptions(true)}
                    />
                  ) : (
                    <Empty />
                  )}
                </Panel>
              </Col>
            </Row>

            <Row className="g-4 mb-4">
              <Col lg="6">
                <Panel title="Customers and visits" subtitle="New sign-ups and bookings per day">
                  {trend.length ? (
                    <Bar
                      data={{
                        labels: trend.map((row) => row.date),
                        datasets: [
                          {
                            label: "Bookings",
                            data: trend.map((row) => row.appointments),
                            backgroundColor: PALETTE[0],
                            borderRadius: 4,
                          },
                          {
                            label: "New customers",
                            data: trend.map((row) => row.customers),
                            backgroundColor: PALETTE[1],
                            borderRadius: 4,
                          },
                        ],
                      }}
                      options={chartOptions(true)}
                    />
                  ) : (
                    <Empty />
                  )}
                </Panel>
              </Col>
              <Col lg="6">
                <Row className="g-4">
                  <StatCard label="Appointments" value={data.customers.appointments} />
                  <StatCard label="Job cards" value={data.customers.jobCards} />
                  <StatCard label="Visiting customers" value={data.customers.visitingCustomers} />
                  <StatCard label="New visitors" value={data.customers.newVisitingCustomers} />
                  <StatCard label="Completed" value={data.customers.completed} tone="success" />
                  <StatCard label="Cancelled" value={data.customers.cancelled} tone="danger" />
                  <StatCard label="No show" value={data.customers.noShow} tone="warning" />
                  <StatCard label="Memberships sold" value={data.memberships.sold} />
                </Row>
              </Col>
            </Row>

            <Row className="g-4 mb-4">
              <Col lg="6">
                <Panel title="Top 10 services" subtitle="Ranked by revenue">
                  <RankChart rows={rankings.topServices} />
                </Panel>
              </Col>
              <Col lg="6">
                <Panel title="Top 10 service categories" subtitle="Ranked by revenue">
                  <RankChart rows={rankings.topServiceCategories} />
                </Panel>
              </Col>
            </Row>

            <Row className="g-4 mb-4">
              <Col lg="6">
                <Panel title="Top 10 staff by service revenue" subtitle="Who delivered the most">
                  <RankChart rows={rankings.topServiceStaff} />
                </Panel>
              </Col>
              <Col lg="6">
                <Panel title="Top 5 products sold" subtitle="Retail and billed products">
                  <RankChart rows={rankings.topProducts} />
                </Panel>
              </Col>
            </Row>

            <Row className="g-4 mb-4">
              <Col lg="6">
                <Panel title="Product payment methods" subtitle="How product sales were paid">
                  {rankings.productPaymentMethods?.length ? (
                    <Pie
                      data={{
                        labels: rankings.productPaymentMethods.map((row) => row.method),
                        datasets: [
                          {
                            data: rankings.productPaymentMethods.map((row) => row.amount),
                            backgroundColor: rankings.productPaymentMethods.map(
                              (_, index) => PALETTE[index % PALETTE.length]
                            ),
                          },
                        ],
                      }}
                      options={chartOptions(true)}
                    />
                  ) : (
                    <Empty />
                  )}
                </Panel>
              </Col>
              <Col lg="6">
                <Panel title="Expenses by category" subtitle="Where the money went">
                  <RankChart rows={rankings.expenseCategories} />
                </Panel>
              </Col>
            </Row>

            <Row className="g-4 mb-4">
              <Col lg="6">
                <RankTable title="Top 10 staff selling products" rows={rankings.topProductStaff} />
              </Col>
              <Col lg="6">
                <RankTable
                  title="Top 10 staff and service combinations"
                  rows={rankings.topStaffServicePairs}
                />
              </Col>
            </Row>

            <Row className="g-4">
              <Col lg="6">
                <RankTable
                  title="Top 10 memberships sold"
                  rows={data.memberships.topSelling}
                  countLabel="Sold"
                />
              </Col>
              <Col lg="6">
                <div className="card card-bordered h-100">
                  <div className="card-inner">
                    <h6 className="title mb-2">Membership summary</h6>
                    <Row className="g-3">
                      <Col sm="6">
                        <div className="text-soft fs-12px">Sold</div>
                        <h6>{data.memberships.sold}</h6>
                      </Col>
                      <Col sm="6">
                        <div className="text-soft fs-12px">Revenue</div>
                        <h6>{formatMoney(data.memberships.revenue)}</h6>
                      </Col>
                      <Col sm="6">
                        <div className="text-soft fs-12px">Still active</div>
                        <h6>{data.memberships.active}</h6>
                      </Col>
                      <Col sm="6">
                        <div className="text-soft fs-12px">Longest lasting plan</div>
                        <h6>
                          {data.memberships.longestDuration
                            ? `${data.memberships.longestDuration.name} (${data.memberships.longestDuration.months} mo)`
                            : "—"}
                        </h6>
                      </Col>
                    </Row>
                    <div className="text-soft fs-12px mt-3 mb-1">
                      Membership payment methods
                    </div>
                    {data.memberships.paymentMethods.length ? (
                      <table className="table table-sm mb-0">
                        <tbody>
                          {data.memberships.paymentMethods.map((row) => (
                            <tr key={row.method}>
                              <td>{row.method}</td>
                              <td className="text-end">{row.count}</td>
                              <td className="text-end">{formatMoney(row.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="text-soft">No memberships sold</div>
                    )}
                  </div>
                </div>
              </Col>
            </Row>
          </>
        )
      )}
    </PageShell>
  );
};

export default SalonReport;
