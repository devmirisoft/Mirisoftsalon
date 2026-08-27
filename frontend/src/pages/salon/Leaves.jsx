import { useEffect, useState } from "react";
import { Alert, Button, Input, Label, Table } from "reactstrap";
import PageShell from "@/components/salon/PageShell";
import { useAuth } from "@/auth/AuthContext";
import RowActionsMenu from "@/components/salon/RowActionsMenu";
import { salonApi } from "@/services/salonApi";
import { formatDate, labelize, todayInputDate } from "@/utils/salonFormat";

const Leaves = () => {
  const { user } = useAuth();
  const manager = ["SUPER_ADMIN","SALON_ADMIN","BRANCH_MANAGER"].includes(user?.role);
  const [rows,setRows]=useState([]), [staff,setStaff]=useState([]), [error,setError]=useState("");
  const [form,setForm]=useState({staffId:"",leaveType:"PAID_LEAVE",startDate:"",endDate:"",reason:""});
  const load=async()=>{try{setError("");const [a,b]=await Promise.all([salonApi.leaves.list(),manager?salonApi.staff.list():Promise.resolve({data:[]})]);setRows(a.data||[]);setStaff(b.data||[]);}catch(e){setError(e.message);}};
  useEffect(()=>{load();},[manager]);
  const submit=async()=>{try{const today=todayInputDate();if(form.startDate&&form.startDate<today){throw new Error("Leave start date cannot be in the past.");}if(form.endDate&&form.endDate<today){throw new Error("Leave end date cannot be in the past.");}await salonApi.leaves.create({...form,...(!form.staffId?{staffId:undefined}:{})});setForm({...form,startDate:"",endDate:"",reason:""});await load();}catch(e){setError(e.message);}};
  const action=async(fn)=>{try{await fn();await load();}catch(e){setError(e.message);}};
  return <PageShell title="Leaves" description="Request leave and manage branch-scoped approvals.">
    {error&&<Alert color="danger">{error}</Alert>}
    <div className="card card-bordered mb-4"><div className="card-inner row g-3">
      {manager&&<div className="col-md-3"><Label>Staff</Label><Input type="select" value={form.staffId} onChange={e=>setForm({...form,staffId:e.target.value})}><option value="">Select staff</option>{staff.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</Input></div>}
      <div className="col-md-2"><Label>Leave type</Label><Input type="select" value={form.leaveType} onChange={e=>setForm({...form,leaveType:e.target.value})}>{["PAID_LEAVE","UNPAID_LEAVE","SICK_LEAVE","CASUAL_LEAVE","OTHER"].map(x=><option key={x}>{labelize(x)}</option>)}</Input></div>
      <div className="col-md-2"><Label>From</Label><Input type="date" min={todayInputDate()} value={form.startDate} onChange={e=>setForm({...form,startDate:e.target.value,endDate:form.endDate&&form.endDate<e.target.value?e.target.value:form.endDate})}/></div><div className="col-md-2"><Label>To</Label><Input type="date" min={form.startDate||todayInputDate()} value={form.endDate} onChange={e=>setForm({...form,endDate:e.target.value})}/></div>
      <div className="col-md-3"><Label>Reason</Label><Input value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}/></div><div><Button color="primary" onClick={submit}>Request leave</Button></div>
    </div></div>
    <div className="card card-bordered"><Table responsive className="mb-0"><thead><tr><th>Staff</th><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th className="text-end">Actions</th></tr></thead><tbody>{rows.map(x=><tr key={x.id}><td>{x.staff?.name}</td><td>{labelize(x.leaveType)}</td><td>{formatDate(x.startDate)} – {formatDate(x.endDate)}</td><td>{x.totalDays}</td><td>{labelize(x.status)}</td><td className="text-end"><RowActionsMenu>{manager&&x.status==="PENDING"&&<><Button size="sm" color="success" onClick={()=>action(()=>salonApi.leaves.approve(x.id))}>Approve</Button><Button size="sm" color="danger" outline onClick={()=>action(()=>salonApi.leaves.reject(x.id,"Rejected by manager"))}>Reject</Button></>}{x.status==="PENDING"&&<Button size="sm" color="secondary" outline onClick={()=>action(()=>salonApi.leaves.cancel(x.id))}>Cancel</Button>}</RowActionsMenu></td></tr>)}</tbody></Table></div>
  </PageShell>;
};
export default Leaves;
