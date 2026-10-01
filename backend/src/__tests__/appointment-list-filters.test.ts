import { appointmentListWhere, resolveStaffIdFilter } from "../features/appointments/appointment.model.js";

describe("appointmentListWhere", () => {
  it("is empty when nothing is filtered", () => {
    expect(appointmentListWhere()).toEqual({});
    expect(appointmentListWhere({})).toEqual({});
  });

  it("applies each filter that is set", () => {
    expect(
      appointmentListWhere({ staffId: "s1", status: "CONFIRMED", branchId: "b1" })
    ).toEqual({
      OR: [{ staffId: "s1" }, { services: { some: { staffId: "s1" } } }],
      status: "CONFIRMED",
      branchId: "b1",
    });
  });

  it("passes real staff ids through and never widens 'me' to everyone", async () => {
    expect(await resolveStaffIdFilter("s1", "u1")).toBe("s1");
    expect(await resolveStaffIdFilter(undefined, "u1")).toBeUndefined();
    expect(await resolveStaffIdFilter("me", undefined)).toBe("__none__");
  });

  it("applies a half-open date range even when only one end is given", () => {
    const dateFrom = new Date("2026-01-01T00:00:00Z");
    const dateTo = new Date("2026-01-02T00:00:00Z");

    expect(appointmentListWhere({ dateFrom, dateTo })).toEqual({
      startTime: { gte: dateFrom, lt: dateTo },
    });
    expect(appointmentListWhere({ dateFrom })).toEqual({
      startTime: { gte: dateFrom },
    });
    expect(appointmentListWhere({ dateTo })).toEqual({
      startTime: { lt: dateTo },
    });
  });
});
