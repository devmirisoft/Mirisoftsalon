import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Input, Label, Spinner, Table } from "reactstrap";
import { useAuth } from "@/auth/AuthContext";
import PageShell from "@/components/salon/PageShell";
import RowActionsMenu from "@/components/salon/RowActionsMenu";
import StatusBadge from "@/components/salon/StatusBadge";
import { salonApi } from "@/services/salonApi";
import {
  currentInputTime,
  formatDate,
  labelize,
  todayInputDate,
} from "@/utils/salonFormat";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const BLOCK_TYPES = [
  "BREAK",
  "PERSONAL",
  "TRAINING",
  "MEETING",
  "OFF",
  "OTHER",
];

const dateValue = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const weekStart = (value = new Date()) => {
  const date = new Date(value);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - date.getDay());
  return dateValue(date);
};

const addDays = (value, days) => {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateValue(date);
};

const timeFromMinutes = (minutes) =>
  `${String(Math.floor(Number(minutes) / 60)).padStart(2, "0")}:${String(
    Number(minutes) % 60
  ).padStart(2, "0")}`;

const minutesFromTime = (value) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

const localIso = (date, time) =>
  new Date(`${date}T${time}:00`).toISOString();

const emptyRule = {
  staffId: "",
  dayOfWeek: "1",
  startTime: "09:00",
  endTime: "18:00",
  effectiveFrom: "",
  effectiveUntil: "",
};

const emptyBlock = {
  staffId: "",
  date: todayInputDate(),
  startTime: "13:00",
  endTime: "14:00",
  type: "BREAK",
  note: "",
};

const ShiftRoster = () => {
  const { user } = useAuth();
  const canManage = ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"].includes(
    user?.role
  );
  const [startDate, setStartDate] = useState(weekStart());
  const [roster, setRoster] = useState({
    staff: [],
    rules: [],
    timeBlocks: [],
    approvedLeaves: [],
  });
  const [services, setServices] = useState([]);
  const [staffFilter, setStaffFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState(user?.branchId || "");
  const [ruleForm, setRuleForm] = useState(emptyRule);
  const [blockForm, setBlockForm] = useState(emptyBlock);
  const [editingRuleId, setEditingRuleId] = useState("");
  const [editingBlockId, setEditingBlockId] = useState("");
  const [preview, setPreview] = useState({
    date: todayInputDate(),
    serviceId: "",
    staffId: "",
  });
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const endDate = addDays(startDate, 6);
  const dates = useMemo(
    () => DAYS.map((day, index) => ({ day, date: addDays(startDate, index) })),
    [startDate]
  );

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [rosterResult, serviceResult] = await Promise.allSettled([
        salonApi.staffRoster.get({ startDate, endDate }),
        user?.role === "BRANCH_MANAGER"
          ? salonApi.jobCarts.references({ branchId: user.branchId })
          : salonApi.services.list(),
      ]);
      if (rosterResult.status === "rejected") throw rosterResult.reason;
      setRoster(rosterResult.value.data);
      setServices(
        serviceResult.status === "fulfilled"
          ? (
              serviceResult.value.data?.services ||
              serviceResult.value.data ||
              []
            ).filter((service) => service.status !== false)
          : []
      );
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Mutations explicitly reload the week.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate]);

  const branches = useMemo(() => {
    const byId = new Map();
    roster.staff.forEach((member) => {
      if (member.branch) byId.set(member.branch.id, member.branch);
    });
    return [...byId.values()].sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  }, [roster.staff]);

  const visibleStaff = roster.staff.filter(
    (member) =>
      (!branchFilter || member.branchId === branchFilter) &&
      (!staffFilter || member.id === staffFilter)
  );

  const memberFor = (staffId) =>
    roster.staff.find((member) => member.id === staffId);

  const resetRule = () => {
    setEditingRuleId("");
    setRuleForm({ ...emptyRule, staffId: staffFilter || "" });
  };

  const resetBlock = () => {
    setEditingBlockId("");
    setBlockForm({ ...emptyBlock, staffId: staffFilter || "" });
  };

  const saveRule = async (event) => {
    event.preventDefault();
    const member = memberFor(ruleForm.staffId);
    if (!member?.branchId) {
      setError("Select a branch-assigned staff member.");
      return;
    }
    if (ruleForm.effectiveFrom && ruleForm.effectiveFrom < todayInputDate()) {
      setError("Effective from date cannot be in the past.");
      return;
    }
    if (ruleForm.effectiveUntil && ruleForm.effectiveUntil < todayInputDate()) {
      setError("Effective until date cannot be in the past.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const body = {
        branchId: member.branchId,
        staffId: member.id,
        dayOfWeek: Number(ruleForm.dayOfWeek),
        startTimeMinutes: minutesFromTime(ruleForm.startTime),
        endTimeMinutes: minutesFromTime(ruleForm.endTime),
        effectiveFrom: ruleForm.effectiveFrom || null,
        effectiveUntil: ruleForm.effectiveUntil || null,
      };
      if (editingRuleId) {
        await salonApi.staffAvailability.update(editingRuleId, body);
      } else {
        await salonApi.staffAvailability.create(body);
      }
      setMessage(
        `Availability rule ${editingRuleId ? "updated" : "created"}.`
      );
      resetRule();
      await load();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSaving(false);
    }
  };

  const editRule = (rule) => {
    setEditingRuleId(rule.id);
    setRuleForm({
      staffId: rule.staffId,
      dayOfWeek: String(rule.dayOfWeek),
      startTime: timeFromMinutes(rule.startTimeMinutes),
      endTime: timeFromMinutes(rule.endTimeMinutes),
      effectiveFrom: rule.effectiveFrom?.slice(0, 10) || "",
      effectiveUntil: rule.effectiveUntil?.slice(0, 10) || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleRule = async (rule) => {
    try {
      await salonApi.staffAvailability.setStatus(
        rule.id,
        rule.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"
      );
      await load();
    } catch (nextError) {
      setError(nextError.message);
    }
  };

  const removeRule = async (rule) => {
    if (!window.confirm(`Delete ${rule.staff?.name}'s availability rule?`)) {
      return;
    }
    try {
      await salonApi.staffAvailability.remove(rule.id);
      await load();
    } catch (nextError) {
      setError(nextError.message);
    }
  };

  const saveBlock = async (event) => {
    event.preventDefault();
    const member = memberFor(blockForm.staffId);
    if (!member?.branchId) {
      setError("Select a branch-assigned staff member.");
      return;
    }
    const start = new Date(`${blockForm.date}T${blockForm.startTime}:00`);
    const end = new Date(`${blockForm.date}T${blockForm.endTime}:00`);
    if (blockForm.date < todayInputDate() || start < new Date()) {
      setError("Time block start cannot be in the past.");
      return;
    }
    if (end <= start) {
      setError("Time block end must be after the start time.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const body = {
        branchId: member.branchId,
        staffId: member.id,
        date: blockForm.date,
        startTime: localIso(blockForm.date, blockForm.startTime),
        endTime: localIso(blockForm.date, blockForm.endTime),
        type: blockForm.type,
        note: blockForm.note || null,
      };
      if (editingBlockId) {
        await salonApi.staffTimeBlocks.update(editingBlockId, body);
      } else {
        await salonApi.staffTimeBlocks.create(body);
      }
      setMessage(`Time block ${editingBlockId ? "updated" : "created"}.`);
      resetBlock();
      await load();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSaving(false);
    }
  };

  const editBlock = (block) => {
    const start = new Date(block.startTime);
    const end = new Date(block.endTime);
    setEditingBlockId(block.id);
    setBlockForm({
      staffId: block.staffId,
      date: block.date.slice(0, 10),
      startTime: `${String(start.getHours()).padStart(2, "0")}:${String(
        start.getMinutes()
      ).padStart(2, "0")}`,
      endTime: `${String(end.getHours()).padStart(2, "0")}:${String(
        end.getMinutes()
      ).padStart(2, "0")}`,
      type: block.type,
      note: block.note || "",
    });
  };

  const removeBlock = async (block) => {
    if (!window.confirm(`Delete this ${labelize(block.type)} block?`)) return;
    try {
      await salonApi.staffTimeBlocks.remove(block.id);
      await load();
    } catch (nextError) {
      setError(nextError.message);
    }
  };

  const previewSlots = async () => {
    const member = preview.staffId ? memberFor(preview.staffId) : null;
    const branchId = member?.branchId || branchFilter;
    if (!branchId || !preview.serviceId) {
      setError("Choose a branch and service to preview slots.");
      return;
    }
    try {
      setError("");
      const result = await salonApi.staffAvailability.slots({
        branchId,
        serviceIds: preview.serviceId,
        date: preview.date,
        ...(preview.staffId ? { staffId: preview.staffId } : {}),
      });
      setSlots(result.data.slots || []);
    } catch (nextError) {
      setError(nextError.message);
    }
  };

  return (
    <PageShell
      title="Shift Roster"
      description="Weekly availability, date-specific blocks, approved leave, and bookable-slot preview."
    >
      {error && <Alert color="danger">{error}</Alert>}
      {message && <Alert color="success">{message}</Alert>}

      <div className="card card-bordered mb-4">
        <div className="card-inner d-flex flex-wrap gap-3 align-items-end">
          <div>
            <Label>Week starting</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(weekStart(event.target.value))}
            />
          </div>
          <div>
            <Label>Branch</Label>
            <Input
              type="select"
              value={branchFilter}
              disabled={["BRANCH_MANAGER", "RECEPTIONIST", "STAFF"].includes(
                user?.role
              )}
              onChange={(event) => {
                setBranchFilter(event.target.value);
                setStaffFilter("");
              }}
            >
              <option value="">All branches</option>
              {branches.map((branch) => (
                <option value={branch.id} key={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Input>
          </div>
          <div>
            <Label>Staff</Label>
            <Input
              type="select"
              value={staffFilter}
              onChange={(event) => setStaffFilter(event.target.value)}
            >
              <option value="">All staff</option>
              {roster.staff
                .filter(
                  (member) =>
                    !branchFilter || member.branchId === branchFilter
                )
                .map((member) => (
                  <option value={member.id} key={member.id}>
                    {member.name}
                  </option>
                ))}
            </Input>
          </div>
          <Button color="light" onClick={() => setStartDate(weekStart())}>
            Current week
          </Button>
        </div>
      </div>

      {canManage && (
        <div className="row g-4 mb-4">
          <div className="col-xl-6">
            <form className="card card-bordered h-100" onSubmit={saveRule}>
              <div className="card-inner">
                <h6>{editingRuleId ? "Edit availability" : "Add availability"}</h6>
                <div className="row g-3">
                  <div className="col-md-6">
                    <Label>Staff</Label>
                    <Input
                      type="select"
                      required
                      value={ruleForm.staffId}
                      onChange={(event) =>
                        setRuleForm({ ...ruleForm, staffId: event.target.value })
                      }
                    >
                      <option value="">Select staff</option>
                      {roster.staff
                        .filter((member) => member.branchId)
                        .map((member) => (
                          <option value={member.id} key={member.id}>
                            {member.name} · {member.branch?.name}
                          </option>
                        ))}
                    </Input>
                  </div>
                  <div className="col-md-6">
                    <Label>Day</Label>
                    <Input
                      type="select"
                      value={ruleForm.dayOfWeek}
                      onChange={(event) =>
                        setRuleForm({
                          ...ruleForm,
                          dayOfWeek: event.target.value,
                        })
                      }
                    >
                      {DAYS.map((day, index) => (
                        <option value={index} key={day}>
                          {day}
                        </option>
                      ))}
                    </Input>
                  </div>
                  <div className="col-md-3">
                    <Label>Start</Label>
                    <Input
                      type="time"
                      required
                      value={ruleForm.startTime}
                      onChange={(event) =>
                        setRuleForm({
                          ...ruleForm,
                          startTime: event.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="col-md-3">
                    <Label>End</Label>
                    <Input
                      type="time"
                      required
                      value={ruleForm.endTime}
                      onChange={(event) =>
                        setRuleForm({
                          ...ruleForm,
                          endTime: event.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="col-md-3">
                    <Label>Effective from</Label>
                  <Input
                      type="date"
                      value={ruleForm.effectiveFrom}
                      min={todayInputDate()}
                      onChange={(event) =>
                        setRuleForm({
                          ...ruleForm,
                          effectiveFrom: event.target.value,
                          effectiveUntil:
                            ruleForm.effectiveUntil &&
                            ruleForm.effectiveUntil < event.target.value
                              ? event.target.value
                              : ruleForm.effectiveUntil,
                        })
                      }
                    />
                  </div>
                  <div className="col-md-3">
                    <Label>Effective until</Label>
                  <Input
                      type="date"
                      value={ruleForm.effectiveUntil}
                      min={ruleForm.effectiveFrom || todayInputDate()}
                      onChange={(event) =>
                        setRuleForm({
                          ...ruleForm,
                          effectiveUntil: event.target.value,
                        })
                      }
                    />
                  </div>
                </div>
              </div>
              <div className="card-inner border-top d-flex gap-2 justify-content-end">
                {editingRuleId && (
                  <Button type="button" color="light" onClick={resetRule}>
                    Cancel
                  </Button>
                )}
                <Button color="primary" disabled={saving}>
                  Save availability
                </Button>
              </div>
            </form>
          </div>

          <div className="col-xl-6">
            <form className="card card-bordered h-100" onSubmit={saveBlock}>
              <div className="card-inner">
                <h6>{editingBlockId ? "Edit time block" : "Add time block"}</h6>
                <div className="row g-3">
                  <div className="col-md-6">
                    <Label>Staff</Label>
                    <Input
                      type="select"
                      required
                      value={blockForm.staffId}
                      onChange={(event) =>
                        setBlockForm({
                          ...blockForm,
                          staffId: event.target.value,
                        })
                      }
                    >
                      <option value="">Select staff</option>
                      {roster.staff
                        .filter((member) => member.branchId)
                        .map((member) => (
                          <option value={member.id} key={member.id}>
                            {member.name} · {member.branch?.name}
                          </option>
                        ))}
                    </Input>
                  </div>
                  <div className="col-md-3">
                    <Label>Date</Label>
                  <Input
                      type="date"
                      required
                      value={blockForm.date}
                      min={todayInputDate()}
                      onChange={(event) =>
                        setBlockForm({
                          ...blockForm,
                          date: event.target.value,
                          startTime:
                            event.target.value === todayInputDate() &&
                            blockForm.startTime < currentInputTime()
                              ? currentInputTime()
                              : blockForm.startTime,
                        })
                      }
                    />
                  </div>
                  <div className="col-md-3">
                    <Label>Type</Label>
                    <Input
                      type="select"
                      value={blockForm.type}
                      onChange={(event) =>
                        setBlockForm({ ...blockForm, type: event.target.value })
                      }
                    >
                      {BLOCK_TYPES.map((type) => (
                        <option value={type} key={type}>
                          {labelize(type)}
                        </option>
                      ))}
                    </Input>
                  </div>
                  <div className="col-md-3">
                    <Label>Start</Label>
                  <Input
                      type="time"
                      required
                      value={blockForm.startTime}
                      min={
                        blockForm.date === todayInputDate()
                          ? currentInputTime()
                          : undefined
                      }
                      onChange={(event) =>
                        setBlockForm({
                          ...blockForm,
                          startTime: event.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="col-md-3">
                    <Label>End</Label>
                  <Input
                      type="time"
                      required
                      value={blockForm.endTime}
                      min={blockForm.startTime}
                      onChange={(event) =>
                        setBlockForm({
                          ...blockForm,
                          endTime: event.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="col-md-6">
                    <Label>Note</Label>
                    <Input
                      value={blockForm.note}
                      onChange={(event) =>
                        setBlockForm({ ...blockForm, note: event.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
              <div className="card-inner border-top d-flex gap-2 justify-content-end">
                {editingBlockId && (
                  <Button type="button" color="light" onClick={resetBlock}>
                    Cancel
                  </Button>
                )}
                <Button color="primary" disabled={saving}>
                  Save time block
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card card-bordered mb-4">
        <div className="card-inner">
          <h6>Weekly roster</h6>
          {loading ? (
            <div className="text-center py-5">
              <Spinner color="primary" />
            </div>
          ) : (
            <Table responsive bordered className="align-middle mb-0">
              <thead>
                <tr>
                  <th>Staff</th>
                  {dates.map(({ day, date }) => (
                    <th key={date}>
                      {day.slice(0, 3)}
                      <small className="d-block text-soft">{date}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleStaff.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <strong>{member.name}</strong>
                      <small className="d-block text-soft">
                        {member.branch?.name || "No branch"}
                      </small>
                    </td>
                    {dates.map(({ date }, dayOfWeek) => {
                      const rules = roster.rules.filter(
                        (rule) =>
                          rule.staffId === member.id &&
                          rule.dayOfWeek === dayOfWeek &&
                          (!rule.effectiveFrom ||
                            rule.effectiveFrom.slice(0, 10) <= date) &&
                          (!rule.effectiveUntil ||
                            rule.effectiveUntil.slice(0, 10) >= date)
                      );
                      const blocks = roster.timeBlocks.filter(
                        (block) =>
                          block.staffId === member.id &&
                          block.date.slice(0, 10) === date
                      );
                      const leaves = roster.approvedLeaves.filter(
                        (leave) =>
                          leave.staffId === member.id &&
                          leave.startDate.slice(0, 10) <= date &&
                          leave.endDate.slice(0, 10) >= date
                      );
                      const hasActiveRules = rules.some(
                        (rule) => rule.status === "ACTIVE"
                      );
                      return (
                        <td key={date} style={{ minWidth: 150 }}>
                          {rules.map((rule) => (
                            <div key={rule.id} className="mb-2">
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-primary w-100"
                                disabled={!canManage}
                                onClick={() => editRule(rule)}
                              >
                                {timeFromMinutes(rule.startTimeMinutes)}–
                                {timeFromMinutes(rule.endTimeMinutes)}
                              </button>
                              <StatusBadge value={rule.status} />
                              {canManage && (
                                <div className="d-flex gap-1 mt-1">
                                  <Button
                                    size="sm"
                                    color="light"
                                    onClick={() => toggleRule(rule)}
                                  >
                                    {rule.status === "ACTIVE"
                                      ? "Disable"
                                      : "Enable"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    color="danger"
                                    outline
                                    onClick={() => removeRule(rule)}
                                  >
                                    Delete
                                  </Button>
                                </div>
                              )}
                            </div>
                          ))}
                          {!hasActiveRules && (
                            <small className="text-soft">
                              Legacy: {member.workingFrom}–{member.workingTo}
                            </small>
                          )}
                          {blocks.map((block) => (
                            <button
                              type="button"
                              key={block.id}
                              className="btn btn-sm btn-warning w-100 mt-2"
                              disabled={!canManage}
                              onClick={() => editBlock(block)}
                            >
                              {labelize(block.type)} ·{" "}
                              {new Date(block.startTime).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </button>
                          ))}
                          {leaves.map((leave) => (
                            <div
                              className="badge bg-danger mt-2 d-block"
                              key={leave.id}
                            >
                              Approved leave
                            </div>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {!visibleStaff.length && (
                  <tr>
                    <td colSpan={8} className="text-center text-soft py-4">
                      No staff found in this scope.
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          )}
        </div>
      </div>

      <div className="row g-4">
        <div className="col-xl-7">
          <div className="card card-bordered h-100">
            <div className="card-inner">
              <h6>Time blocks this week</h6>
              <Table responsive className="mb-0">
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Type</th>
                    {canManage && <th className="text-end">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {roster.timeBlocks
                    .filter(
                      (block) =>
                        visibleStaff.some(
                          (member) => member.id === block.staffId
                        )
                    )
                    .map((block) => (
                      <tr key={block.id}>
                        <td>{block.staff?.name}</td>
                        <td>{formatDate(block.date)}</td>
                        <td>
                          {new Date(block.startTime).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          –
                          {new Date(block.endTime).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td>{labelize(block.type)}</td>
                        {canManage && (
                          <td className="text-end">
                            <RowActionsMenu>
                              <Button size="sm" outline onClick={() => editBlock(block)}>
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                color="danger"
                                outline
                                onClick={() => removeBlock(block)}
                              >
                                Delete
                              </Button>
                            </RowActionsMenu>
                          </td>
                        )}
                      </tr>
                    ))}
                </tbody>
              </Table>
            </div>
          </div>
        </div>
        <div className="col-xl-5">
          <div className="card card-bordered h-100">
            <div className="card-inner">
              <h6>Preview available slots</h6>
              <div className="row g-3">
                <div className="col-md-6">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={preview.date}
                    min={todayInputDate()}
                    onChange={(event) =>
                      setPreview({ ...preview, date: event.target.value })
                    }
                  />
                </div>
                <div className="col-md-6">
                  <Label>Staff</Label>
                  <Input
                    type="select"
                    value={preview.staffId}
                    onChange={(event) =>
                      setPreview({ ...preview, staffId: event.target.value })
                    }
                  >
                    <option value="">Any available staff</option>
                    {visibleStaff.map((member) => (
                      <option value={member.id} key={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </Input>
                </div>
                <div className="col-12">
                  <Label>Service</Label>
                  <Input
                    type="select"
                    value={preview.serviceId}
                    onChange={(event) =>
                      setPreview({ ...preview, serviceId: event.target.value })
                    }
                  >
                    <option value="">Select service</option>
                    {services.map((service) => (
                      <option value={service.id} key={service.id}>
                        {service.name}
                      </option>
                    ))}
                  </Input>
                </div>
                <div className="col-12">
                  <Button color="primary" onClick={previewSlots}>
                    Check slots
                  </Button>
                </div>
              </div>
              <div className="d-flex flex-wrap gap-2 mt-3">
                {slots.slice(0, 24).map((slot) => (
                  <span
                    className="badge bg-outline-primary"
                    key={`${slot.staffId}-${slot.startTime}`}
                  >
                    {new Date(slot.startTime).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {slot.staffName}
                  </span>
                ))}
                {!slots.length && (
                  <small className="text-soft">
                    Choose a date and service to preview availability.
                  </small>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
};

export default ShiftRoster;
