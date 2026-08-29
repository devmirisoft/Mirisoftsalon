import { useEffect, useState } from "react";
import { Alert, Input, Label, Table } from "reactstrap";
import PageShell from "@/components/salon/PageShell";
import ReportExportButtons from "@/components/salon/ReportExportButtons";
import { salonApi } from "@/services/salonApi";
import { formatMoney, labelize } from "@/utils/salonFormat";

const now = new Date();

const StaffPerformance = () => {
  const [filter, setFilter] = useState({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  });
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    salonApi.reports
      .staffPerformance(filter)
      .then((response) => setRows(response.data || []))
      .catch((loadError) => setError(loadError.message));
  }, [filter]);

  return (
    <PageShell
      title="Staff Performance"
      description="Operational output, attendance, commissions, and payroll by staff."
      tools={
        <ReportExportButtons reportType="staff-performance" filters={filter} />
      }
    >
      {error && <Alert color="danger">{error}</Alert>}
      <div className="d-flex gap-3 mb-4">
        <div>
          <Label>Month</Label>
          <Input
            type="number"
            min="1"
            max="12"
            value={filter.month}
            onChange={(event) =>
              setFilter({ ...filter, month: Number(event.target.value) })
            }
          />
        </div>
        <div>
          <Label>Year</Label>
          <Input
            type="number"
            value={filter.year}
            onChange={(event) =>
              setFilter({ ...filter, year: Number(event.target.value) })
            }
          />
        </div>
      </div>
      <div className="card card-bordered">
        <Table responsive className="mb-0">
          <thead>
            <tr>
              <th>Staff</th><th>Appointments</th><th>Service revenue</th>
              <th>Retail revenue</th><th>Attendance</th><th>Commission</th>
              <th>Net salary</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.staffId}>
                <td>{row.name}<small className="d-block text-soft">{row.staffCode || row.jobRole}</small></td>
                <td>{row.completedAppointments} completed / {row.cancelledAppointments} cancelled</td>
                <td>{formatMoney(row.serviceRevenue)}</td>
                <td>{formatMoney(row.retailSalesRevenue)}</td>
                <td>{row.presentDays} present, {row.lateDays} late</td>
                <td>{formatMoney(Number(row.serviceCommissionAmount) + Number(row.retailCommissionAmount))}</td>
                <td>{row.netSalary === null ? "—" : formatMoney(row.netSalary)}</td>
                <td>{row.salaryStatus ? labelize(row.salaryStatus) : "Not generated"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </PageShell>
  );
};

export default StaffPerformance;
