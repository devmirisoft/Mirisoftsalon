import { Button, Icon } from "@/components/Component";
import AppointmentStatusBadge, {
  appointmentStatusClass,
} from "@/components/salon/AppointmentStatusBadge";

const timeOf = (value) =>
  value
    ? new Date(value).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const AppointmentDayPanel = ({
  date,
  appointments,
  onClose,
  onSelect,
  onAdd,
}) => (
  <div className="card card-bordered appt-day-panel">
    <div className="card-inner border-bottom appt-day-head">
      <div>
        <h6 className="title mb-0">
          {new Date(`${date}T00:00`).toLocaleDateString(undefined, {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </h6>
        <span className="sub-text">
          {appointments.length} Appointment{appointments.length === 1 ? "" : "s"}
        </span>
      </div>
      <Button
        color="light"
        className="btn-icon btn-trigger"
        aria-label="Close day"
        onClick={onClose}
      >
        <Icon name="cross" />
      </Button>
    </div>
    <div className="card-inner appt-day-list">
      {appointments.length === 0 ? (
        <p className="text-soft text-center py-4 mb-0">
          No appointments on this day.
        </p>
      ) : (
        appointments.map((appointment) => (
          <button
            type="button"
            key={appointment.id}
            className={`appt-day-card ${appointmentStatusClass(appointment.status)}`}
            onClick={() => onSelect(appointment)}
          >
            <span className="appt-day-card-top">
              <span className="appt-day-time">
                <span className="appt-day-dot" />
                {timeOf(appointment.startTime)}
              </span>
              <AppointmentStatusBadge value={appointment.status} />
            </span>
            <span className="appt-day-name">
              {appointment.customer?.name || "Customer"}
            </span>
            <span className="appt-day-meta">
              <span className="appt-day-meta-item">
                <Icon name="user-alt" />
                <em>Customer</em>
                {appointment.customer?.phone || appointment.appointmentCode}
              </span>
              <span className="appt-day-meta-item">
                <Icon name="users" />
                <em>Staff</em>
                {appointment.staff?.name || "Unassigned"}
              </span>
              <span className="appt-day-meta-item is-full">
                <Icon name="scissor" />
                <em>Service</em>
                {appointment.services?.map((item) => item.serviceName).join(", ") ||
                  "—"}
              </span>
            </span>
          </button>
        ))
      )}
    </div>
    {onAdd && (
      <div className="card-inner border-top">
        <Button color="primary" className="w-100 justify-content-center" onClick={onAdd}>
          <Icon name="plus" />
          <span>Add Appointment</span>
        </Button>
      </div>
    )}
  </div>
);

export default AppointmentDayPanel;
