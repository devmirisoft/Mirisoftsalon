import { useEffect, useState } from "react";
import { salonApi } from "@/services/salonApi";

const formatTime = (value) =>
  new Date(value).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

const blockLabels = {
  BREAK: "On break",
  TRAINING: "In training",
  MEETING: "In a meeting",
  PERSONAL: "Personal time",
  OFF: "Off",
  OTHER: "Blocked",
};

// One row of GET /staff-availability/status as the words shown to people.
// `nowish`: the time asked about is (about) now, so "now" reads right.
const statusText = (row, nowish) => {
  switch (row.state) {
    case "FREE":
      if (row.until) return `Free till ${formatTime(row.until)}`;
      return nowish ? "Available now" : "Available";
    case "BOOKED": {
      const what = `${row.booking.kind === "JOB_CART" ? "Job cart" : "Appointment"} ${row.booking.appointmentCode}`;
      return row.booking.runningLate
        ? `Booked · ${what} (running late)`
        : `Booked · ${what} till ${formatTime(row.until)}`;
    }
    case "BLOCKED":
      return `${blockLabels[row.blockType] || "Blocked"} till ${formatTime(row.until)}`;
    case "IN_AT":
      return `In at ${formatTime(row.until)}`;
    case "SHIFT_ENDED":
      return "Shift ended";
    default:
      return row.onLeave ? "On leave" : "Off today";
  }
};

// staffId -> { available, text } for `branchId` at `at` (anything Date
// parses; omit for now), or null while unknown. `refreshKey` refetches, e.g.
// each time a picker opens, since "now" moves on.
export const useStaffStatus = (branchId, at, refreshKey) => {
  const [statusById, setStatusById] = useState(null);
  useEffect(() => {
    setStatusById(null);
    const when = at ? new Date(at) : null;
    if (!branchId || (when && Number.isNaN(when.getTime()))) return undefined;
    let active = true;
    salonApi.staffAvailability
      .status({ branchId, ...(when ? { at: when.toISOString() } : {}) })
      .then((response) => {
        if (!active) return;
        const nowish = !when || Math.abs(when - Date.now()) < 15 * 60_000;
        setStatusById(
          new Map(
            (response.data?.staff || []).map((row) => [
              row.staffId,
              { available: row.state === "FREE", text: statusText(row, nowish) },
            ])
          )
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [branchId, at, refreshKey]);
  return statusById;
};

// Coloured dot plus the word, so the state never relies on colour alone.
// Only the dot is coloured: the theme's green is too light for body text.
// `compact` (the selected value) keeps it to one truncated line so the
// control stays input height; the open menu puts the status under the name.
export const StaffOptionLabel = ({ name, status, compact = false }) => (
  <span className={compact ? "d-flex align-items-center gap-2 overflow-hidden" : "d-block"}>
    <span className={compact ? "text-truncate flex-shrink-0" : "d-block"}>{name}</span>
    {status && (
      <span
        className={`small ${compact ? "text-truncate" : "d-block"}${
          status.available ? "" : " text-soft"
        }`}
      >
        <span
          aria-hidden="true"
          style={{ color: status.available ? "#1ee0ac" : "#8094ae" }}
        >
          ●{" "}
        </span>
        {status.text}
      </span>
    )}
  </span>
);
