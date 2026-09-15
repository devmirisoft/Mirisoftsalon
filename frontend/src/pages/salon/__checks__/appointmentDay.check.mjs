// Self-check for the day-panel selection rules on the appointments calendar.
// Run: node frontend/src/pages/salon/__checks__/appointmentDay.check.mjs
// Mirrors toISODate + dayAppointments in Appointments.jsx.
import assert from "node:assert/strict";

export const toISODate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;

export const dayAppointments = (appointments, day) =>
  appointments
    .filter((item) => toISODate(new Date(item.startTime)) === day)
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

const at = (local) => new Date(local).toISOString();
const rows = [
  { id: "late", startTime: at("2026-09-10T17:00") },
  { id: "early", startTime: at("2026-09-10T09:00") },
  { id: "next", startTime: at("2026-09-11T09:00") },
  { id: "edge", startTime: at("2026-09-10T23:45") },
];

// Local dates, not the UTC slice of the ISO string.
assert.equal(toISODate(new Date("2026-09-10T23:45")), "2026-09-10");
// Only the chosen day, oldest first.
assert.deepEqual(
  dayAppointments(rows, "2026-09-10").map((item) => item.id),
  ["early", "late", "edge"]
);
// A day with nothing on it is empty, not everything.
assert.deepEqual(dayAppointments(rows, "2026-09-12"), []);

console.log("appointmentDay: ok");
