/* eslint-disable react/prop-types */
import { useMemo } from "react";
import { withLanes } from "@/utils/dayBoardLanes";

const START_HOUR = 7;
const END_HOUR = 23;
const PX_PER_MIN = 1.3;
const SLOT_MINUTES = 30;
const COLUMN_MIN_WIDTH = 190;
const HEADER_HEIGHT = 56;
const GUTTER_WIDTH = 64;

const HOURS = Array.from(
  { length: END_HOUR - START_HOUR },
  (_, index) => START_HOUR + index
);
const BODY_HEIGHT = (END_HOUR - START_HOUR) * 60 * PX_PER_MIN;

// One pastel per staff column, reused round-robin.
const PALETTE = [
  { bg: "#ffe3ee", accent: "#d63384" },
  { bg: "#fff6cc", accent: "#b58100" },
  { bg: "#e7e0ff", accent: "#6f42c1" },
  { bg: "#d9f5e4", accent: "#0f9d58" },
  { bg: "#dceeff", accent: "#0d6efd" },
  { bg: "#ffe6d5", accent: "#d9480f" },
];

const DIMMED_STATUSES = new Set(["CANCELLED", "NO_SHOW"]);

const minutesFromStart = (value) => {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes() - START_HOUR * 60;
};

const timeLabel = (value) =>
  new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const initials = (name = "") =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

// ponytail: appointments with no staff (or staff outside the shown columns)
// are not drawn here; they stay visible in the calendar and list views.
const StaffDayBoard = ({
  date,
  staff,
  appointments,
  onAppointmentClick,
  onSlotClick,
}) => {
  const byStaff = useMemo(() => {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const map = new Map(staff.map((member) => [member.id, []]));
    appointments.forEach((appointment) => {
      const start = new Date(appointment.startTime);
      if (start < dayStart || start >= dayEnd) return;
      const column = map.get(appointment.staff?.id);
      if (!column) return;
      const top = minutesFromStart(appointment.startTime) * PX_PER_MIN;
      const end = appointment.endTime
        ? minutesFromStart(appointment.endTime) * PX_PER_MIN
        : top + 30 * PX_PER_MIN;
      column.push({
        appointment,
        top: Math.max(top, 0),
        height: Math.max(end - top, 34),
      });
    });
    return new Map(
      Array.from(map, ([staffId, items]) => [staffId, withLanes(items)])
    );
  }, [appointments, date, staff]);

  const nowTop = useMemo(() => {
    const now = new Date();
    if (now.toDateString() !== new Date(date).toDateString()) return null;
    const top = minutesFromStart(now) * PX_PER_MIN;
    return top >= 0 && top <= BODY_HEIGHT ? top : null;
  }, [date]);

  const bookSlot = (member, event) => {
    const offsetY =
      event.clientY - event.currentTarget.getBoundingClientRect().top;
    const minutes =
      Math.floor(offsetY / PX_PER_MIN / SLOT_MINUTES) * SLOT_MINUTES;
    const slot = new Date(date);
    slot.setHours(START_HOUR, 0, 0, 0);
    slot.setMinutes(slot.getMinutes() + minutes);
    onSlotClick?.(slot, member);
  };

  if (!staff.length) {
    return (
      <div className="card card-bordered">
        <div className="card-inner text-center text-soft py-5">
          No staff to show. Add staff members to see their day columns.
        </div>
      </div>
    );
  }

  return (
    <div className="card card-bordered">
      <div className="card-inner p-0" style={{ overflowX: "auto" }}>
        <div style={{ display: "flex", minWidth: "fit-content" }}>
          <div style={{ width: GUTTER_WIDTH, flex: "none" }}>
            <div
              style={{
                height: HEADER_HEIGHT,
                borderBottom: "1px solid #dbdfea",
              }}
            />
            <div style={{ position: "relative", height: BODY_HEIGHT }}>
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="text-soft"
                  style={{
                    position: "absolute",
                    top: (hour - START_HOUR) * 60 * PX_PER_MIN,
                    right: 8,
                    fontSize: 11,
                    transform: "translateY(-6px)",
                  }}
                >
                  {new Date(2000, 0, 1, hour).toLocaleTimeString([], {
                    hour: "numeric",
                  })}
                </div>
              ))}
            </div>
          </div>
          {staff.map((member, index) => {
            const color = PALETTE[index % PALETTE.length];
            const items = byStaff.get(member.id) || [];
            return (
              <div
                key={member.id}
                style={{
                  flex: `1 1 ${COLUMN_MIN_WIDTH}px`,
                  minWidth: COLUMN_MIN_WIDTH,
                  borderLeft: "1px solid #dbdfea",
                }}
              >
                <div
                  className="d-flex align-items-center gap-2 px-2"
                  style={{
                    height: HEADER_HEIGHT,
                    borderBottom: "1px solid #dbdfea",
                  }}
                >
                  <span
                    className="d-inline-flex align-items-center justify-content-center"
                    style={{
                      width: 28,
                      height: 28,
                      flex: "none",
                      borderRadius: "50%",
                      background: color.bg,
                      color: color.accent,
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {initials(member.name) || "?"}
                  </span>
                  <span className="fw-bold text-truncate" title={member.name}>
                    {member.name}
                  </span>
                  <span
                    className="badge rounded-pill ms-auto"
                    style={{ background: color.bg, color: color.accent }}
                  >
                    {items.length}
                  </span>
                </div>
                <div
                  role="presentation"
                  onClick={(event) => bookSlot(member, event)}
                  style={{
                    position: "relative",
                    height: BODY_HEIGHT,
                    cursor: "copy",
                    backgroundImage: `repeating-linear-gradient(to bottom, #eef1f7 0, #eef1f7 1px, transparent 1px, transparent ${
                      SLOT_MINUTES * PX_PER_MIN
                    }px)`,
                  }}
                >
                  {nowTop !== null && (
                    <div
                      style={{
                        position: "absolute",
                        top: nowTop,
                        left: 0,
                        right: 0,
                        borderTop: "1px solid #e85347",
                        pointerEvents: "none",
                      }}
                    />
                  )}
                  {items.map((item) => {
                    const dimmed = DIMMED_STATUSES.has(item.appointment.status);
                    return (
                      <button
                        type="button"
                        key={item.appointment.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          onAppointmentClick?.(item.appointment);
                        }}
                        title={[
                          item.appointment.appointmentCode,
                          item.appointment.services
                            ?.map((service) => service.serviceName)
                            .join(", "),
                          item.appointment.status,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        style={{
                          position: "absolute",
                          top: item.top,
                          height: item.height,
                          left: `calc(${(item.lane / item.lanes) * 100}% + 3px)`,
                          width: `calc(${100 / item.lanes}% - 6px)`,
                          display: "flex",
                          flexDirection: "column",
                          overflow: "hidden",
                          textAlign: "left",
                          padding: "4px 6px",
                          border: "none",
                          borderLeft: `3px solid ${color.accent}`,
                          borderRadius: 6,
                          background: color.bg,
                          opacity: dimmed ? 0.55 : 1,
                          textDecoration: dimmed ? "line-through" : "none",
                          fontSize: 11,
                          lineHeight: 1.35,
                        }}
                      >
                        <span className="fw-medium">
                          {timeLabel(item.appointment.startTime)}
                          {item.appointment.endTime
                            ? ` - ${timeLabel(item.appointment.endTime)}`
                            : ""}
                        </span>
                        <span className="fw-bold text-truncate">
                          {item.appointment.customer?.name || "Customer"}
                        </span>
                        <span className="text-truncate" style={{ opacity: 0.75 }}>
                          {item.appointment.services
                            ?.map((service) => service.serviceName)
                            .join(", ")}
                        </span>
                        <span
                          className="mt-auto text-truncate"
                          style={{ color: color.accent, fontWeight: 600 }}
                        >
                          {member.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default StaffDayBoard;
