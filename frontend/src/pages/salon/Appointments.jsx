/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DatePicker from "react-datepicker";
import {
  Alert,
  Col,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalHeader,
  Row,
  Spinner,
} from "reactstrap";
import { Button, Icon } from "@/components/Component";
import PageShell from "@/components/salon/PageShell";
import AppointmentBookingModal from "@/components/salon/AppointmentBookingModal";
import AppointmentCalendar from "@/components/salon/AppointmentCalendar";
import AppointmentDetailsModal from "@/components/salon/AppointmentDetailsModal";
import StaffDayBoard from "@/components/salon/StaffDayBoard";
import DataGrid from "@/components/salon/DataGrid";
import SchemaModal from "@/components/salon/SchemaModal";
import StatusBadge from "@/components/salon/StatusBadge";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import {
  formatDate,
  formatMoney,
  minDateTimeInput,
  roleCanManage,
  toLocalInput,
} from "@/utils/salonFormat";
import ReportExportButtons from "@/components/salon/ReportExportButtons";

const STATUSES = [
  "SCHEDULED",
  "CONFIRMED",
  "CHECKED_IN",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];

const LIST_COLUMNS = [
  { key: "appointmentCode", label: "Appointment" },
  { key: "customer", label: "Customer", render: (value) => value?.name || "—" },
  { key: "staff", label: "Staff", render: (value) => value?.name || "—" },
  { key: "startTime", label: "Start", render: (value) => formatDate(value, true) },
  { key: "estimatedAmount", label: "Amount", render: formatMoney },
  { key: "status", label: "Status", render: (value) => <StatusBadge value={value} /> },
];

const toISODate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;

const sameDay = (value, day) => {
  const date = new Date(value);
  return (
    date.getFullYear() === day.getFullYear() &&
    date.getMonth() === day.getMonth() &&
    date.getDate() === day.getDate()
  );
};

const nextAvailableTime = (dateInfo) => {
  const selected = new Date(dateInfo.date);
  const now = new Date();

  if (dateInfo.allDay) {
    const isToday =
      selected.getFullYear() === now.getFullYear() &&
      selected.getMonth() === now.getMonth() &&
      selected.getDate() === now.getDate();

    if (isToday) {
      selected.setTime(now.getTime());
      selected.setSeconds(0, 0);
      selected.setMinutes(Math.ceil(selected.getMinutes() / 30) * 30);
    } else {
      selected.setHours(9, 0, 0, 0);
    }
  }

  return selected;
};

const Appointments = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [refs, setRefs] = useState({
    salons: [],
    branches: [],
    customers: [],
    staff: [],
    services: [],
  });
  const [filters, setFilters] = useState({ date: "", status: "", staffId: "" });
  const [view, setView] = useState("calendar");
  const [scheduleStaffId, setScheduleStaffId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [action, setAction] = useState(null);
  const [appointmentDefaults, setAppointmentDefaults] = useState({});
  const [newCustomerContext, setNewCustomerContext] = useState(null);
  const [newCustomerId, setNewCustomerId] = useState("");
  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(null);
  const [tracking, setTracking] = useState(null);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const isSuper = user?.role === "SUPER_ADMIN";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await salonApi.appointments.list(filters);
      setAppointments(response.data || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadRefs = useCallback(async () => {
    const [salons, branches, customers, staff, services] =
      await Promise.allSettled([
        isSuper ? salonApi.salons.list() : Promise.resolve({ data: [] }),
        user?.role === "STAFF"
          ? Promise.resolve({ data: [] })
          : salonApi.branches.list(),
        salonApi.customers.list(),
        user?.role === "STAFF"
          ? Promise.resolve({ data: [] })
          : salonApi.staff.list(),
        salonApi.services.list(),
      ]);
    setRefs({
      salons: salons.status === "fulfilled" ? salons.value.data || [] : [],
      branches: branches.status === "fulfilled" ? branches.value.data || [] : [],
      customers:
        customers.status === "fulfilled" ? customers.value.data || [] : [],
      staff: staff.status === "fulfilled" ? staff.value.data || [] : [],
      services: services.status === "fulfilled" ? services.value.data || [] : [],
    });
  }, [isSuper, user?.role]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadRefs();
  }, [loadRefs]);

  const openAction = (type, row = null, defaults = {}) => {
    if (type === "create") setAppointmentDefaults(defaults);
    setSelected(row);
    setAction(type);
  };

  const openCalendarBooking = (dateInfo, staffId = "") => {
    const startTime = nextAvailableTime(dateInfo);
    if (startTime < new Date()) {
      setError("Appointments cannot be booked in the past.");
      return;
    }

    setError("");
    openAction("create", null, {
      startTime: toLocalInput(startTime),
      ...(staffId ? { staffId } : {}),
    });
  };

  const viewDetails = async (row) => {
    try {
      const response = await salonApi.appointments.get(row.id);
      setDetails(response.data);
    } catch (viewError) {
      setError(viewError.message);
    }
  };

  const viewTracking = async (row) => {
    setTracking({ row, data: [] });
    setTrackingLoading(true);
    try {
      const response = await salonApi.appointments.tracking(row.id);
      setTracking({ row, data: response.data || [] });
    } catch (viewError) {
      setError(viewError.message);
    } finally {
      setTrackingLoading(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete appointment ${row.appointmentCode}?`)) return;
    try {
      await salonApi.appointments.remove(row.id);
      await load();
    } catch (deleteError) {
      setError(deleteError.message);
    }
  };

  const availableStaff = useMemo(() => {
    if (refs.staff.length) return refs.staff;
    const byId = new Map();
    appointments.forEach((appointment) => {
      if (appointment.staff?.id) byId.set(appointment.staff.id, appointment.staff);
    });
    return Array.from(byId.values());
  }, [appointments, refs.staff]);

  const boardStaff = useMemo(
    () =>
      scheduleStaffId
        ? availableStaff.filter((member) => member.id === scheduleStaffId)
        : availableStaff,
    [availableStaff, scheduleStaffId]
  );

  const boardDate = useMemo(
    () => (filters.date ? new Date(`${filters.date}T00:00`) : new Date()),
    [filters.date]
  );

  const shiftBoardDay = (days) => {
    const next = new Date(boardDate);
    next.setDate(next.getDate() + days);
    setFilters((current) => ({ ...current, date: toISODate(next) }));
  };

  const boardAppointments = useMemo(() => {
    const ids = new Set(boardStaff.map((member) => member.id));
    return appointments
      .filter(
        (appointment) =>
          ids.has(appointment.staff?.id) &&
          sameDay(appointment.startTime, boardDate)
      )
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  }, [appointments, boardDate, boardStaff]);

  const formConfig = useMemo(() => {
    if (action === "status") {
      return {
        title: `Update status · ${selected?.appointmentCode}`,
        submitLabel: "Update status",
        fields: [
          {
            name: "status",
            label: "New status",
            type: "select",
            required: true,
            options: STATUSES.map((value) => ({ value, label: value })),
          },
          { name: "note", label: "Status note", type: "textarea", fullWidth: true },
        ],
        initialValues: { status: selected?.status },
        submit: (values) => salonApi.appointments.setStatus(selected.id, values),
      };
    }
    if (action === "reschedule") {
      return {
        title: `Reschedule · ${selected?.appointmentCode}`,
        submitLabel: "Reschedule",
        fields: [
          {
            name: "startTime",
            label: "New start time",
            type: "datetime-local",
            min: minDateTimeInput(),
            required: true,
          },
        ],
        initialValues: { startTime: toLocalInput(selected?.startTime) },
        submit: (values) => {
          const startTime = new Date(values.startTime);
          if (Number.isNaN(startTime.getTime()) || startTime < new Date()) {
            throw new Error("Choose a start time from now onward.");
          }
          return salonApi.appointments.reschedule(
            selected.id,
            startTime.toISOString()
          );
        },
      };
    }
    if (action === "notes") {
      return {
        title: `Appointment notes · ${selected?.appointmentCode}`,
        submitLabel: "Save notes",
        fields: [
          { name: "bookingNote", label: "Booking note", type: "textarea", fullWidth: true, nullable: true },
          { name: "internalNote", label: "Internal note", type: "textarea", fullWidth: true, nullable: true },
        ],
        initialValues: selected,
        submit: (values) => salonApi.appointments.update(selected.id, values),
      };
    }
    return null;
  }, [action, selected]);

  const newCustomerFields = useMemo(
    () => [
      { name: "name", label: "Customer name", required: true },
      { name: "phone", label: "Phone", type: "tel", required: true },
      { name: "email", label: "Email", type: "email", nullable: true },
      {
        name: "status",
        label: "Customer status",
        type: "select",
        defaultValue: "REGULAR",
        options: ["REGULAR", "PREMIUM", "IRREGULAR"].map((value) => ({
          value,
          label: value,
        })),
      },
      ...(isSuper
        ? [
            {
              name: "salonId",
              label: "Salon",
              type: "select",
              required: true,
              options: refs.salons.map((item) => ({
                value: item.id,
                label: item.name,
              })),
            },
          ]
        : []),
      {
        name: "branchId",
        label: "Branch",
        type: "select",
        nullable: true,
        options: refs.branches.map((item) => ({
          value: item.id,
          label: item.name,
        })),
      },
      {
        name: "customNotes",
        label: "Customer notes",
        type: "textarea",
        fullWidth: true,
        nullable: true,
      },
    ],
    [isSuper, refs.branches, refs.salons]
  );

  return (
    <PageShell
      title="Appointments"
      description="Book services, prevent staff conflicts, track status, reschedule, and maintain operational notes."
      actionLabel="Book appointment"
      onAction={() => openAction("create")}
      tools={
        <ReportExportButtons
          reportType="appointments"
          filters={{
            ...(filters.date ? { from: filters.date, to: filters.date } : {}),
            ...(filters.status ? { status: filters.status } : {}),
            ...(filters.staffId ? { staffId: filters.staffId } : {}),
          }}
        />
      }
    >
      {error && <Alert color="danger">{error}</Alert>}
      <div className="card card-bordered mb-4">
        <div className="card-inner">
          <Row className="g-3 align-items-end">
            <Col md="3">
              <Label>Date</Label>
              <Input
                type="date"
                value={filters.date}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, date: event.target.value }))
                }
              />
            </Col>
            <Col md="3">
              <Label>Status</Label>
              <Input
                type="select"
                value={filters.status}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, status: event.target.value }))
                }
              >
                <option value="">All statuses</option>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </Input>
            </Col>
            <Col md="3">
              <Label>Staff</Label>
              <Input
                type="select"
                value={filters.staffId}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, staffId: event.target.value }))
                }
              >
                <option value="">All staff</option>
                {refs.staff.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </Input>
            </Col>
            <Col md="3">
              <Button
                color="light"
                className="w-100"
                onClick={() => setFilters({ date: "", status: "", staffId: "" })}
              >
                <Icon name="reload" /> Clear filters
              </Button>
            </Col>
          </Row>
        </div>
      </div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h5 className="title mb-0">
          {view === "calendar"
            ? "Appointment calendar"
            : view === "staff"
              ? "Staff schedule"
              : "Appointment list"}
        </h5>
        <div className="btn-group">
          <Button
            color={view === "calendar" ? "primary" : "light"}
            onClick={() => setView("calendar")}
          >
            <Icon name="calender-date" /> Calendar
          </Button>
          <Button
            color={view === "staff" ? "primary" : "light"}
            onClick={() => setView("staff")}
          >
            <Icon name="users" /> Staff
          </Button>
          <Button
            color={view === "list" ? "primary" : "light"}
            onClick={() => setView("list")}
          >
            <Icon name="list-index" /> List
          </Button>
        </div>
      </div>

      {loading && view !== "list" ? (
        <div className="card card-bordered">
          <div className="card-inner text-center py-5">
            <Spinner color="primary" />
            <p className="text-soft mt-2 mb-0">Loading appointment calendar…</p>
          </div>
        </div>
      ) : view === "calendar" ? (
        <AppointmentCalendar
          appointments={appointments}
          onAppointmentClick={viewDetails}
          onDateSelect={openCalendarBooking}
        />
      ) : view === "staff" ? (
        <>
          <div className="card card-bordered mb-3">
            <div className="card-inner">
              <Row className="g-3 align-items-end">
                <Col md="4">
                  <Label>Staff member</Label>
                  <Input
                    type="select"
                    value={scheduleStaffId}
                    onChange={(event) => setScheduleStaffId(event.target.value)}
                  >
                    <option value="">All staff</option>
                    {availableStaff.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </Input>
                </Col>
                <Col md="8">
                  <div className="d-flex align-items-center justify-content-md-end gap-2 flex-wrap">
                    <Button color="light" onClick={() => shiftBoardDay(-1)}>
                      <Icon name="chevron-left" />
                    </Button>
                    <span className="fw-bold">{formatDate(boardDate)}</span>
                    <Button color="light" onClick={() => shiftBoardDay(1)}>
                      <Icon name="chevron-right" />
                    </Button>
                    <Button
                      color="light"
                      onClick={() =>
                        setFilters((current) => ({ ...current, date: "" }))
                      }
                    >
                      Today
                    </Button>
                  </div>
                </Col>
              </Row>
              <p className="mt-3 mb-0 text-soft small">
                Click a slot in a staff column to book that staff member.
              </p>
            </div>
          </div>
          <Row className="g-3">
            <Col xl="3">
              <div className="card card-bordered h-100">
                <div className="card-inner">
                  <div className="staff-board-datepicker">
                    <DatePicker
                      inline
                      selected={boardDate}
                      onChange={(day) =>
                        setFilters((current) => ({
                          ...current,
                          date: toISODate(day),
                        }))
                      }
                    />
                  </div>
                  <h6 className="title mt-4 mb-2">{formatDate(boardDate)}</h6>
                  <ul className="list-unstyled mb-0 small">
                    {[
                      ["All events", boardAppointments.length],
                      [
                        "Cancelled",
                        boardAppointments.filter(
                          (row) => row.status === "CANCELLED"
                        ).length,
                      ],
                      [
                        "No-show",
                        boardAppointments.filter(
                          (row) => row.status === "NO_SHOW"
                        ).length,
                      ],
                      [
                        "Completed",
                        boardAppointments.filter(
                          (row) => row.status === "COMPLETED"
                        ).length,
                      ],
                    ].map(([label, count]) => (
                      <li
                        key={label}
                        className="d-flex justify-content-between py-1"
                      >
                        <span className="text-soft">{label}</span>
                        <span className="fw-bold">{count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Col>
            <Col xl="9">
              <StaffDayBoard
                date={boardDate}
                staff={boardStaff}
                appointments={appointments}
                onAppointmentClick={viewDetails}
                onSlotClick={(slot, member) =>
                  openCalendarBooking({ date: slot, allDay: false }, member.id)
                }
              />
            </Col>
          </Row>
          <h6 className="title mt-4 mb-2">
            {scheduleStaffId
              ? `${boardStaff[0]?.name || "Staff"}'s appointments`
              : "Staff appointments"}{" "}
            · {formatDate(boardDate)}
          </h6>
          <DataGrid
            rows={boardAppointments}
            loading={loading}
            columns={LIST_COLUMNS}
            onView={viewDetails}
          />
        </>
      ) : (
        <DataGrid
          rows={appointments}
          loading={loading}
          columns={LIST_COLUMNS}
          onView={viewDetails}
          onDelete={roleCanManage(user?.role) ? remove : undefined}
          renderActions={(row) => (
            <>
              {row.status === "COMPLETED" && (
                <Button
                  size="sm"
                  color="success"
                  className="me-1"
                  onClick={() => navigate(`/appointments/${row.id}/bill`)}
                >
                  <Icon name="file-plus" /> Make bill
                </Button>
              )}
              <Button size="sm" color="info" outline onClick={() => openAction("status", row)}>
                Status
              </Button>
              <Button size="sm" color="primary" outline className="ms-1" onClick={() => openAction("reschedule", row)}>
                Reschedule
              </Button>
              <Button size="sm" color="light" className="ms-1" onClick={() => openAction("notes", row)}>
                Notes
              </Button>
              <Button size="sm" color="light" className="ms-1" onClick={() => viewTracking(row)}>
                Track
              </Button>
            </>
          )}
        />
      )}

      <AppointmentBookingModal
        isOpen={action === "create"}
        toggle={() => setAction(null)}
        isSuper={isSuper}
        statuses={STATUSES}
        refs={{ ...refs, staff: availableStaff }}
        defaults={appointmentDefaults}
        newCustomerId={newCustomerId}
        onCreateCustomer={(customerName, values) =>
          setNewCustomerContext({
            name: customerName,
            salonId: values.salonId || "",
            branchId: values.branchId || "",
            status: "REGULAR",
          })
        }
        onSubmit={async (payload) => {
          await salonApi.appointments.create(payload);
          await load();
        }}
      />
      {formConfig && (
        <SchemaModal
          isOpen
          toggle={() => setAction(null)}
          title={formConfig.title}
          fields={formConfig.fields}
          initialValues={formConfig.initialValues}
          submitLabel={formConfig.submitLabel}
          onSubmit={async (values) => {
            await formConfig.submit(values);
            if (action === "status" && values.status === "COMPLETED") {
              navigate(`/appointments/${selected.id}/bill`);
              return;
            }
            await load();
          }}
        />
      )}
      <SchemaModal
        isOpen={Boolean(newCustomerContext)}
        toggle={() => setNewCustomerContext(null)}
        title="Add new customer"
        fields={newCustomerFields}
        initialValues={newCustomerContext}
        submitLabel="Add customer"
        onSubmit={async (values) => {
          const response = await salonApi.customers.create(values);
          const customer = response.data;
          setRefs((current) => ({
            ...current,
            customers: [...current.customers, customer],
          }));
          // The booking modal stays open and picks this up, keeping the cart.
          setNewCustomerId(customer.id);
        }}
      />
      <AppointmentDetailsModal
        isOpen={Boolean(details)}
        toggle={() => setDetails(null)}
        appointment={details}
        onStatus={(appointment) => {
          setDetails(null);
          openAction("status", appointment);
        }}
        onReschedule={(appointment) => {
          setDetails(null);
          openAction("reschedule", appointment);
        }}
        onNotes={(appointment) => {
          setDetails(null);
          openAction("notes", appointment);
        }}
        onTracking={(appointment) => {
          setDetails(null);
          viewTracking(appointment);
        }}
        onMakeBill={(appointment) => {
          setDetails(null);
          navigate(`/appointments/${appointment.id}/bill`);
        }}
      />
      <Modal isOpen={Boolean(tracking)} toggle={() => setTracking(null)} centered>
        <ModalHeader toggle={() => setTracking(null)}>
          Status history · {tracking?.row?.appointmentCode}
        </ModalHeader>
        <ModalBody>
          {trackingLoading ? (
            <div className="text-center py-4"><Spinner color="primary" /></div>
          ) : (
            <div className="timeline">
              {(tracking?.data || []).map((item) => (
                <div className="timeline-item" key={item.id}>
                  <div className="timeline-status bg-primary is-outline" />
                  <div className="timeline-date">{formatDate(item.createdAt, true)}</div>
                  <div className="timeline-data">
                    <h6 className="timeline-title mb-1">
                      {item.oldStatus || "Created"} → {item.newStatus}
                    </h6>
                    <div className="timeline-des">
                      <p>{item.note || "No note"}</p>
                      <span className="text-soft">
                        {item.changedBy?.name || "System"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              {tracking?.data?.length === 0 && (
                <p className="text-center text-soft py-4">No status history yet.</p>
              )}
            </div>
          )}
        </ModalBody>
      </Modal>
    </PageShell>
  );
};

export default Appointments;
