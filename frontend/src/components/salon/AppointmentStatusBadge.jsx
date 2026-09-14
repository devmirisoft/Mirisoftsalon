/* eslint-disable react/prop-types */
import { labelize } from "@/utils/salonFormat";

// Colours live in salon-app.scss as .appt-status-<status in lower case>.
export const appointmentStatusClass = (status) =>
  `appt-status appt-status-${String(status || "").toLowerCase()}`;

const AppointmentStatusBadge = ({ value }) => (
  <span className={appointmentStatusClass(value)}>{labelize(value)}</span>
);

export default AppointmentStatusBadge;
