/* eslint-disable react/prop-types */
import { labelize } from "@/utils/salonFormat";

// Only the colour variables. Calendar events take this on its own; the pill
// shape lives in .appt-status, which the badge below adds.
export const appointmentStatusClass = (status) =>
  `appt-status-${String(status || "").toLowerCase()}`;

const AppointmentStatusBadge = ({ value }) => (
  <span className={`appt-status ${appointmentStatusClass(value)}`}>
    {labelize(value)}
  </span>
);

export default AppointmentStatusBadge;
