import { useEffect, useState } from "react";
import { Alert, Button, Input, Label, Table } from "reactstrap";
import PageShell from "@/components/salon/PageShell";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import { formatDate, labelize } from "@/utils/salonFormat";

const Attendance = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [staff, setStaff] = useState([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ staffId: "", date: new Date().toISOString().slice(0, 10), status: "PRESENT" });
  const selfOnly = user?.role === "STAFF";
  const load = async () => {
    try {
      setError("");
      const [attendance, people] = await Promise.all([
        salonApi.attendance.list({ date: form.date }),
        selfOnly ? Promise.resolve({ data: [] }) : salonApi.staff.list(),
      ]);
      setRows(attendance.data || []);
      setStaff(people.data || []);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, [form.date, selfOnly]);
  const act = async (action) => {
    try {
      const body = { date: form.date, ...(form.staffId ? { staffId: form.staffId } : {}) };
      if (action === "mark") await salonApi.attendance.mark({ ...body, status: form.status });
      if (action === "in") await salonApi.attendance.checkIn(body);
      if (action === "out") await salonApi.attendance.checkOut(body);
      await load();
    } catch (e) { setError(e.message); }
  };
  return <PageShell title="Attendance" description="Daily attendance, check-ins, late status, and branch-scoped records.">
    {error && <Alert color="danger">{error}</Alert>}
    <div className="card card-bordered mb-4"><div className="card-inner d-flex flex-wrap gap-3 align-items-end">
      <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
      {!selfOnly && <div><Label>Staff</Label><Input type="select" value={form.staffId} onChange={(e) => setForm({ ...form, staffId: e.target.value })}><option value="">Select staff</option>{staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Input></div>}
      {!selfOnly && <div><Label>Status</Label><Input type="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{["PRESENT","ABSENT","HALF_DAY","WEEK_OFF","PAID_LEAVE","UNPAID_LEAVE"].map((x) => <option key={x}>{labelize(x)}</option>)}</Input></div>}
      <Button color="success" onClick={() => act("in")}>Check in</Button><Button color="secondary" onClick={() => act("out")}>Check out</Button>
      {!selfOnly && <Button color="primary" onClick={() => act("mark")}>Mark attendance</Button>}
    </div></div>
    <div className="card card-bordered"><Table responsive className="mb-0"><thead><tr><th>Date</th><th>Staff</th><th>Status</th><th>Check in</th><th>Check out</th><th>Late</th></tr></thead><tbody>{rows.map((x) => <tr key={x.id}><td>{formatDate(x.date)}</td><td>{x.staff?.name}</td><td>{labelize(x.status)}</td><td>{x.checkInTime ? new Date(x.checkInTime).toLocaleTimeString() : "—"}</td><td>{x.checkOutTime ? new Date(x.checkOutTime).toLocaleTimeString() : "—"}</td><td>{x.lateMinutes} min</td></tr>)}</tbody></Table></div>
  </PageShell>;
};
export default Attendance;
