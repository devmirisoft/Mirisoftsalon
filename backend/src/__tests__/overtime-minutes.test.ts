import { overtimeMinutesFor } from "../features/staff-availability/staffAvailability.service.js";

const at = (iso: string) => new Date(iso);

describe("overtimeMinutesFor", () => {
  const base = {
    shiftEnd: at("2026-09-04T13:00:00Z"),
    checkInTime: at("2026-09-04T04:00:00Z"),
    checkOutTime: null,
    latestBookingEnd: null,
    slotStart: at("2026-09-04T12:30:00Z"),
    slotEnd: at("2026-09-04T13:45:00Z"),
  };

  it("counts only the minutes past the shift end", () => {
    expect(overtimeMinutesFor(base)).toBe(45);
  });

  it("is zero when the service finishes inside the shift", () => {
    expect(
      overtimeMinutesFor({ ...base, slotEnd: at("2026-09-04T12:45:00Z") })
    ).toBe(0);
  });

  it("measures from the logout when staff checked out early", () => {
    expect(
      overtimeMinutesFor({
        ...base,
        checkOutTime: at("2026-09-04T12:00:00Z"),
      })
    ).toBe(105);
  });

  it("keeps a later booking's overtime when this slot is shorter", () => {
    expect(
      overtimeMinutesFor({
        ...base,
        slotEnd: at("2026-09-04T12:45:00Z"),
        latestBookingEnd: at("2026-09-04T14:00:00Z"),
      })
    ).toBe(60);
  });

  it("counts from clock-in on a day with no rostered shift", () => {
    expect(
      overtimeMinutesFor({ ...base, shiftEnd: null })
    ).toBe(585);
  });
});
