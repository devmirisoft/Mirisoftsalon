import { useEffect, useRef, useState } from "react";
import { Alert, Button, Input, Label } from "reactstrap";
import PageShell from "@/components/salon/PageShell";
import { salonApi } from "@/services/salonApi";
import { formatMoney, labelize, todayInputDate } from "@/utils/salonFormat";

const initial = {
  staffId: "",
  baseSalary: "",
  salaryType: "MONTHLY",
  workingDaysPerMonth: 26,
  paidLeavesAllowed: 0,
  lateGraceMinutes: 10,
  latePenaltyType: "NONE",
  latePenaltyAmount: 0,
  serviceCommissionPercentage: 0,
  serviceMinimumWorkThreshold: 0,
  retailCommissionPercentage: 0,
  retailMinimumSalesThreshold: 0,
  effectiveFrom: todayInputDate(),
};

const formFromConfig = (staffId, config) => ({
  staffId,
  baseSalary: config.baseSalary ?? "",
  salaryType: config.salaryType ?? initial.salaryType,
  workingDaysPerMonth:
    config.workingDaysPerMonth ?? initial.workingDaysPerMonth,
  paidLeavesAllowed: config.paidLeavesAllowed ?? initial.paidLeavesAllowed,
  lateGraceMinutes: config.lateGraceMinutes ?? initial.lateGraceMinutes,
  latePenaltyType: config.latePenaltyType ?? initial.latePenaltyType,
  latePenaltyAmount: config.latePenaltyAmount ?? initial.latePenaltyAmount,
  serviceCommissionPercentage:
    config.serviceCommissionPercentage ??
    initial.serviceCommissionPercentage,
  serviceMinimumWorkThreshold:
    config.serviceMinimumWorkThreshold ??
    initial.serviceMinimumWorkThreshold,
  retailCommissionPercentage:
    config.retailCommissionPercentage ??
    initial.retailCommissionPercentage,
  retailMinimumSalesThreshold:
    config.retailMinimumSalesThreshold ??
    initial.retailMinimumSalesThreshold,
  effectiveFrom: new Date(config.effectiveFrom).toISOString().slice(0, 10),
});

const payloadFromForm = (form) => ({
  baseSalary: Number(form.baseSalary),
  salaryType: form.salaryType,
  workingDaysPerMonth: Number(form.workingDaysPerMonth),
  paidLeavesAllowed: Number(form.paidLeavesAllowed),
  lateGraceMinutes: Number(form.lateGraceMinutes),
  latePenaltyType: form.latePenaltyType,
  latePenaltyAmount: Number(form.latePenaltyAmount),
  serviceCommissionPercentage: Number(form.serviceCommissionPercentage),
  serviceMinimumWorkThreshold: Number(form.serviceMinimumWorkThreshold),
  retailCommissionPercentage: Number(form.retailCommissionPercentage),
  retailMinimumSalesThreshold: Number(form.retailMinimumSalesThreshold),
  effectiveFrom: form.effectiveFrom,
});

const SalaryConfig = () => {
  const [staff, setStaff] = useState([]);
  const [form, setForm] = useState(initial);
  const [active, setActive] = useState(null);
  const [error, setError] = useState("");
  const selectedStaffId = useRef("");

  useEffect(() => {
    salonApi.staff
      .list()
      .then((response) => setStaff(response.data || []))
      .catch((requestError) => setError(requestError.message));
  }, []);

  const select = async (id) => {
    selectedStaffId.current = id;
    setForm({ ...initial, staffId: id });
    setActive(null);
    setError("");
    if (!id) return;

    try {
      const response = await salonApi.salaryConfigs.active(id);
      if (selectedStaffId.current !== id) return;
      setActive(response.data);
      setForm(formFromConfig(id, response.data));
    } catch (requestError) {
      if (selectedStaffId.current === id && requestError.status !== 404) {
        setError(requestError.message);
      }
    }
  };

  const save = async () => {
    try {
      setError("");
      if (form.effectiveFrom < todayInputDate()) {
        throw new Error("Effective from date cannot be in the past.");
      }
      const body = payloadFromForm(form);
      const response = active
        ? await salonApi.salaryConfigs.update(active.id, body)
        : await salonApi.salaryConfigs.create(form.staffId, body);
      setActive(response.data);
      setForm(formFromConfig(form.staffId, response.data));
    } catch (requestError) {
      setError(requestError.message);
    }
  };
  const field=(name,label,type="number")=><div className="col-md-3"><Label>{label}</Label><Input type={type} min={type==="date"?todayInputDate():undefined} value={form[name]??""} onChange={e=>setForm({...form,[name]:e.target.value})}/></div>;
  return <PageShell title="Salary Config" description="Effective-dated salary, penalty, and commission rules.">{error&&<Alert color="danger">{error}</Alert>}<div className="card card-bordered"><div className="card-inner row g-3"><div className="col-md-4"><Label>Staff</Label><Input type="select" value={form.staffId} onChange={e=>select(e.target.value)}><option value="">Select staff</option>{staff.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</Input></div>{field("baseSalary","Base salary")}{field("workingDaysPerMonth","Working days")}{field("paidLeavesAllowed","Paid leaves allowed")}
  <div className="col-md-3"><Label>Salary type</Label><Input type="select" value={form.salaryType} onChange={e=>setForm({...form,salaryType:e.target.value})}>{["MONTHLY","DAILY"].map(x=><option key={x}>{labelize(x)}</option>)}</Input></div>{field("lateGraceMinutes","Late grace (minutes)")}<div className="col-md-3"><Label>Late penalty</Label><Input type="select" value={form.latePenaltyType} onChange={e=>setForm({...form,latePenaltyType:e.target.value})}>{["NONE","FIXED_PER_LATE_DAY","PER_LATE_MINUTE"].map(x=><option key={x}>{labelize(x)}</option>)}</Input></div>{field("latePenaltyAmount","Penalty amount")}{field("serviceCommissionPercentage","Service commission %")}{field("serviceMinimumWorkThreshold","Service threshold")}{field("retailCommissionPercentage","Retail commission %")}{field("retailMinimumSalesThreshold","Retail threshold")}{field("effectiveFrom","Effective from","date")}<div className="col-12"><Button color="primary" disabled={!form.staffId} onClick={save}>{active?"Update configuration":"Create configuration"}</Button>{active&&<span className="ms-3 text-soft">Active base: {formatMoney(active.baseSalary)}</span>}</div></div></div></PageShell>;
};
export default SalaryConfig;
