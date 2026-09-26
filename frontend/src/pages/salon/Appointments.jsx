/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DatePicker from "react-datepicker";
import {
  Alert,
  Input,
  Modal,
  ModalBody,
  ModalHeader,
  Spinner,
} from "reactstrap";
import { Button, Icon } from "@/components/Component";
import PageShell from "@/components/salon/PageShell";
import AppointmentBookingModal from "@/components/salon/AppointmentBookingModal";
import AppointmentCalendar from "@/components/salon/AppointmentCalendar";
import AppointmentDayPanel from "@/components/salon/AppointmentDayPanel";
import AppointmentDetailsModal from "@/components/salon/AppointmentDetailsModal";
import AppointmentStatusBadge from "@/components/salon/AppointmentStatusBadge";
import SchemaModal from "@/components/salon/SchemaModal";
import { ProductUsageModal } from "@/components/salon/InventoryModals";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import {
  formatDate,
  labelize,
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

const EMPTY_FILTERS = { from: "", to: "", status: "", staffId: "", q: "" };
const BRANCH_LOCKED_ROLES = ["BRANCH_MANAGER", "RECEPTIONIST", "STAFF"];

const toISODate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;

const fromISODate = (value) => (value ? new Date(`${value}T00:00`) : null);

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
  // The toolbar applies as you change it: dates/status/staff refetch, the
  // name/phone box filters what is already loaded.
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [action, setAction] = useState(null);
  const [appointmentDefaults, setAppointmentDefaults] = useState({});
  const [newCustomerContext, setNewCustomerContext] = useState(null);
  const [newCustomerId, setNewCustomerId] = useState("");
  const [selected, setSelected] = useState(null);
  // Completing an appointment asks for the product usage first.
  const [completing, setCompleting] = useState(null);
  const [selectedDay, setSelectedDay] = useState("");
  const [details, setDetails] = useState(null);
  const [tracking, setTracking] = useState(null);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const isSuper = user?.role === "SUPER_ADMIN";
  const isBranchLocked = BRANCH_LOCKED_ROLES.includes(user?.role);

  const query = useMemo(
    () => ({
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: filters.to } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.staffId ? { staffId: filters.staffId } : {}),
    }),
    [filters.from, filters.staffId, filters.status, filters.to]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await salonApi.appointments.list(query);
      setAppointments(response.data || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [query]);

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
    window.addEventListener("appointments:refresh", load);
    return () => window.removeEventListener("appointments:refresh", load);
  }, [load]);

  useEffect(() => {
    loadRefs();
  }, [loadRefs]);

  const openAction = (type, row = null, defaults = {}) => {
    if (type === "create") setAppointmentDefaults(defaults);
    setSelected(row);
    setAction(type);
  };

  // Every empty calendar box opens the booking flow. Existing appointment
  // events keep their separate details action.
  const onCalendarDate = (dateInfo) => {
    openCalendarBooking(dateInfo);
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
      setDetails(null);
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

  // Name/phone search runs over the loaded set, so it costs no round trip.
  const visible = useMemo(() => {
    const term = filters.q.trim().toLowerCase();
    if (!term) return appointments;
    return appointments.filter((appointment) =>
      `${appointment.customer?.name || ""} ${appointment.customer?.phone || ""}`
        .toLowerCase()
        .includes(term)
    );
  }, [appointments, filters.q]);

  // The toolbar's staff filter doubles as the staff board's column picker.
  const boardStaff = useMemo(
    () =>
      filters.staffId
        ? availableStaff.filter((member) => member.id === filters.staffId)
        : availableStaff,
    [availableStaff, filters.staffId]
  );

  const dayAppointments = useMemo(
    () =>
      visible
        .filter(
          (appointment) =>
            toISODate(new Date(appointment.startTime)) === selectedDay
        )
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime)),
    [visible, selectedDay]
  );

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
            options: STATUSES.map((value) => ({
              value,
              label: labelize(value),
            })),
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
      className="appt-page page-tight"
      title="Appointments"
      description="Book services, prevent staff conflicts, track status, reschedule, and maintain operational notes."
      actionLabel="Book Appointment"
      onAction={() => openAction("create")}
      tools={<ReportExportButtons reportType="appointments" filters={query} />}
    >
      {error && <Alert color="danger">{error}</Alert>}
      <div className="appt-status-legend" aria-label="Appointment status color code">
        <span className="appt-status-legend-title">Color code:</span>
        {STATUSES.map((status) => (
          <AppointmentStatusBadge key={status} value={status} />
        ))}
      </div>
      <div className="card card-bordered appt-filter-card">
        <div className="card-inner">
          <div className="filter-bar">
            <div className="filter-bar-item is-wide">
              <label className="filter-bar-label" htmlFor="appt-filter-date">
                Date
              </label>
              <div className="form-control-wrap">
                <div className="form-icon form-icon-right">
                  <Icon name="calender-date" />
                </div>
                <DatePicker
                  id="appt-filter-date"
                  selectsRange
                  className="form-control"
                  dateFormat="dd-MM-yyyy"
                  placeholderText="All dates"
                  startDate={fromISODate(filters.from)}
                  endDate={fromISODate(filters.to)}
                  onChange={([start, end]) =>
                    setFilters((current) => ({
                      ...current,
                      from: start ? toISODate(start) : "",
                      to: end ? toISODate(end) : "",
                    }))
                  }
                />
              </div>
            </div>
            <div className="filter-bar-item">
              <label className="filter-bar-label" htmlFor="appt-filter-status">
                Status
              </label>
              <Input
                id="appt-filter-status"
                type="select"
                value={filters.status}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, status: event.target.value }))
                }
              >
                <option value="">All statuses</option>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {labelize(status)}
                  </option>
                ))}
              </Input>
            </div>
            <div className="filter-bar-item">
              <label className="filter-bar-label" htmlFor="appt-filter-staff">
                Staff
              </label>
              <Input
                id="appt-filter-staff"
                type="select"
                value={filters.staffId}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, staffId: event.target.value }))
                }
              >
                <option value="">All staff</option>
                {availableStaff.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </Input>
            </div>
            <div className="filter-bar-item is-grow">
              <div className="form-control-wrap">
                <div className="form-icon form-icon-left">
                  <Icon name="search" />
                </div>
                <Input
                  value={filters.q}
                  placeholder="Search by customer name or phone"
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, q: event.target.value }))
                  }
                />
              </div>
            </div>
            <Button color="light" onClick={() => setFilters(EMPTY_FILTERS)}>
              <Icon name="reload" />
              <span>Clear</span>
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card card-bordered">
          <div className="card-inner text-center py-5">
            <Spinner color="primary" />
            <p className="text-soft mt-2 mb-0">Loading appointment calendar…</p>
          </div>
        </div>
      ) : (
        <div className="appt-board">
          <AppointmentCalendar
            appointments={visible}
            onAppointmentClick={viewDetails}
            onDateSelect={onCalendarDate}
            selectedDate={selectedDay}
            onDateChange={setSelectedDay}
            focusDate={filters.from}
            staff={boardStaff}
            onSlotClick={(slot, member) =>
              openCalendarBooking({ date: slot, allDay: false }, member.id)
            }
          />
          {selectedDay && (
            <AppointmentDayPanel
              date={selectedDay}
              appointments={dayAppointments}
              onClose={() => setSelectedDay("")}
              onSelect={viewDetails}
              onAdd={() =>
                openCalendarBooking({
                  date: new Date(`${selectedDay}T00:00`),
                  allDay: true,
                })
              }
            />
          )}
        </div>
      )}

      <AppointmentBookingModal
        isOpen={action === "create"}
        toggle={() => setAction(null)}
        isSuper={isSuper}
        lockBranch={isBranchLocked}
        defaultBranchId={isBranchLocked ? user?.branchId || "" : ""}
        statuses={STATUSES}
        refs={{ ...refs, staff: availableStaff }}
        defaults={appointmentDefaults}
        newCustomerId={newCustomerId}
        onCreateCustomer={(customerName, values) =>
          setNewCustomerContext({
            name: customerName,
            phone: values.customerPhone || "",
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
            if (
              action === "status" &&
              values.status === "COMPLETED" &&
              selected?.status !== "COMPLETED"
            ) {
              setCompleting({ appointment: selected, values });
              return;
            }
            await formConfig.submit(values);
            await load();
          }}
        />
      )}
      <ProductUsageModal
        isOpen={Boolean(completing)}
        appointmentId={completing?.appointment.id}
        title={`Complete ${completing?.appointment.appointmentCode || ""} · Record Product Usage`}
        confirmLabel="Confirm Usage & Complete"
        onCancel={() => setCompleting(null)}
        onConfirm={async (usage) => {
          const { appointment, values } = completing;
          await salonApi.appointments.setStatus(appointment.id, {
            ...values,
            ...(usage.length ? { usage } : {}),
          });
          setCompleting(null);
          navigate(`/appointments/${appointment.id}/bill`);
        }}
      />
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
        onDelete={roleCanManage(user?.role) ? remove : undefined}
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
