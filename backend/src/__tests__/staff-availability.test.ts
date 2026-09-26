import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { app } from "../app.js";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const tokenFor = (actor: {
  id: string;
  role: string;
  salonId?: string | null;
  branchId?: string | null;
}) =>
  jwt.sign(
    {
      userId: actor.id,
      role: actor.role,
      ...(actor.salonId ? { salonId: actor.salonId } : {}),
      ...(actor.branchId ? { branchId: actor.branchId } : {}),
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "15m" }
  );

const dateAfter = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const fixture = async () => {
  const marker = randomUUID();
  const salon = await prisma.salon.create({
    data: {
      name: `Roster Salon ${marker}`,
      timezone: "UTC",
    },
  });
  const branch = await prisma.branch.create({
    data: { salonId: salon.id, name: `Roster Main ${marker}` },
  });
  const otherBranch = await prisma.branch.create({
    data: { salonId: salon.id, name: `Roster Other ${marker}` },
  });
  const [admin, manager, otherManager, staffUser] = await Promise.all([
    prisma.user.create({
      data: {
        name: "Roster Admin",
        email: `roster-admin-${marker}@test.com`,
        passwordHash: "test",
        role: "SALON_ADMIN",
        salonId: salon.id,
      },
    }),
    prisma.user.create({
      data: {
        name: "Roster Manager",
        email: `roster-manager-${marker}@test.com`,
        passwordHash: "test",
        role: "BRANCH_MANAGER",
        salonId: salon.id,
        branchId: branch.id,
      },
    }),
    prisma.user.create({
      data: {
        name: "Other Roster Manager",
        email: `roster-other-manager-${marker}@test.com`,
        passwordHash: "test",
        role: "BRANCH_MANAGER",
        salonId: salon.id,
        branchId: otherBranch.id,
      },
    }),
    prisma.user.create({
      data: {
        name: "Roster Staff User",
        email: `roster-staff-user-${marker}@test.com`,
        passwordHash: "test",
        role: "STAFF",
        salonId: salon.id,
        branchId: branch.id,
      },
    }),
  ]);
  const [staff, otherStaff] = await Promise.all([
    prisma.staff.create({
      data: {
        salonId: salon.id,
        branchId: branch.id,
        userId: staffUser.id,
        name: "Roster Stylist",
        email: `roster-stylist-${marker}@test.com`,
        jobRole: "Stylist",
        workingFrom: "09:00",
        workingTo: "18:00",
        weekOff: "NEVER",
      },
    }),
    prisma.staff.create({
      data: {
        salonId: salon.id,
        branchId: otherBranch.id,
        name: "Other Roster Stylist",
        email: `roster-other-stylist-${marker}@test.com`,
        jobRole: "Stylist",
        workingFrom: "09:00",
        workingTo: "18:00",
        weekOff: "NEVER",
      },
    }),
  ]);
  const customer = await prisma.customer.create({
    data: {
      salonId: salon.id,
      branchId: branch.id,
      customerCode: `ROSTER-${marker}`,
      name: "Roster Customer",
      phone: `9${marker.replace(/\D/g, "").slice(0, 9).padEnd(9, "1")}`,
    },
  });
  const mainService = await prisma.mainService.create({
    data: { salonId: salon.id, name: `Roster Services ${marker}` },
  });
  const service = await prisma.service.create({
    data: {
      salonId: salon.id,
      branchId: branch.id,
      mainServiceId: mainService.id,
      name: `Roster Cut ${marker}`,
      price: 500,
      durationValue: 60,
      durationUnit: "MINUTES",
    },
  });
  const setting = await prisma.publicBookingSetting.create({
    data: {
      salonId: salon.id,
      branchId: branch.id,
      slug: `roster-${marker}`,
      isEnabled: true,
      minNoticeMinutes: 0,
      bookingWindowDays: 365,
      slotIntervalMinutes: 30,
    },
  });
  return {
    salon,
    branch,
    otherBranch,
    staff,
    otherStaff,
    customer,
    service,
    setting,
    adminToken: tokenFor(admin),
    managerToken: tokenFor(manager),
    otherManagerToken: tokenFor(otherManager),
    staffToken: tokenFor(staffUser),
  };
};

const ruleBody = (
  f: Awaited<ReturnType<typeof fixture>>,
  date: string,
  overrides: Record<string, unknown> = {}
) => ({
  branchId: f.branch.id,
  staffId: f.staff.id,
  dayOfWeek: new Date(`${date}T00:00:00.000Z`).getUTCDay(),
  startTimeMinutes: 600,
  endTimeMinutes: 720,
  ...overrides,
});

const createRule = (
  f: Awaited<ReturnType<typeof fixture>>,
  date: string,
  overrides: Record<string, unknown> = {}
) =>
  request(app)
    .post("/api/staff-availability")
    .set(auth(f.adminToken))
    .send(ruleBody(f, date, overrides));

const blockBody = (
  f: Awaited<ReturnType<typeof fixture>>,
  date: string,
  overrides: Record<string, unknown> = {}
) => ({
  branchId: f.branch.id,
  staffId: f.staff.id,
  date,
  startTime: `${date}T10:00:00.000Z`,
  endTime: `${date}T11:00:00.000Z`,
  type: "BREAK",
  ...overrides,
});

const createAppointment = (
  f: Awaited<ReturnType<typeof fixture>>,
  startTime: string
) =>
  request(app)
    .post("/api/appointments")
    .set(auth(f.adminToken))
    .send({
      branchId: f.branch.id,
      customerId: f.customer.id,
      staffId: f.staff.id,
      serviceIds: [f.service.id],
      startTime,
    });

describe("Staff availability and shift roster", () => {
  it("creates an availability rule and returns it through roster APIs", async () => {
    const f = await fixture();
    const date = dateAfter(14);
    const created = await createRule(f, date).expect(201);
    expect(created.body.data).toMatchObject({
      staffId: f.staff.id,
      branchId: f.branch.id,
      startTimeMinutes: 600,
      endTimeMinutes: 720,
      status: "ACTIVE",
    });

    const roster = await request(app)
      .get("/api/staff-roster")
      .query({ startDate: date, endDate: date })
      .set(auth(f.managerToken))
      .expect(200);
    expect(roster.body.data.rules).toHaveLength(1);
  });

  it("rejects invalid and overlapping availability ranges", async () => {
    const f = await fixture();
    const date = dateAfter(15);
    await createRule(f, date).expect(201);
    await createRule(f, date, {
      startTimeMinutes: 720,
      endTimeMinutes: 600,
    }).expect(400);
    await createRule(f, date, {
      startTimeMinutes: 660,
      endTimeMinutes: 780,
    }).expect(409);
    await createRule(f, date, {
      startTimeMinutes: 720,
      endTimeMinutes: 780,
    }).expect(201);
  });

  it("creates a time block and rejects an overlapping block", async () => {
    const f = await fixture();
    const date = dateAfter(16);
    await request(app)
      .post("/api/staff-time-blocks")
      .set(auth(f.adminToken))
      .send(blockBody(f, date))
      .expect(201);
    await request(app)
      .post("/api/staff-time-blocks")
      .set(auth(f.adminToken))
      .send(
        blockBody(f, date, {
          startTime: `${date}T10:30:00.000Z`,
          endTime: `${date}T11:30:00.000Z`,
        })
      )
      .expect(409);
  });

  it("enforces roster windows for internal appointment creation", async () => {
    const f = await fixture();
    const date = dateAfter(17);
    await createRule(f, date).expect(201);

    await createAppointment(f, `${date}T09:00:00.000Z`).expect(400);
    const inside = await createAppointment(
      f,
      `${date}T10:00:00.000Z`
    ).expect(201);
    expect(inside.body.data.staffId).toBe(f.staff.id);
  });

  it("rejects internal appointments during a time block", async () => {
    const f = await fixture();
    const date = dateAfter(18);
    await createRule(f, date).expect(201);
    await prisma.staffTimeBlock.create({
      data: {
        salonId: f.salon.id,
        branchId: f.branch.id,
        staffId: f.staff.id,
        date: new Date(`${date}T00:00:00.000Z`),
        startTime: new Date(`${date}T10:00:00.000Z`),
        endTime: new Date(`${date}T11:00:00.000Z`),
        type: "TRAINING",
      },
    });
    const response = await createAppointment(
      f,
      `${date}T10:00:00.000Z`
    ).expect(400);
    expect(response.body.message).toMatch(/blocked time/i);
  });

  it("rejects internal appointments during approved leave", async () => {
    const f = await fixture();
    const date = dateAfter(19);
    await createRule(f, date).expect(201);
    await prisma.staffLeave.create({
      data: {
        salonId: f.salon.id,
        branchId: f.branch.id,
        staffId: f.staff.id,
        leaveType: "PAID_LEAVE",
        startDate: new Date(`${date}T00:00:00.000Z`),
        endDate: new Date(`${date}T00:00:00.000Z`),
        totalDays: 1,
        status: "APPROVED",
      },
    });
    const response = await createAppointment(
      f,
      `${date}T10:00:00.000Z`
    ).expect(400);
    expect(response.body.message).toMatch(/approved leave/i);
  });

  it("runs the same availability checks when rescheduling", async () => {
    const f = await fixture();
    const firstDate = dateAfter(20);
    const secondDate = dateAfter(27);
    await createRule(f, firstDate).expect(201);
    const appointment = await createAppointment(
      f,
      `${firstDate}T10:00:00.000Z`
    ).expect(201);

    await request(app)
      .patch(`/api/appointments/${appointment.body.data.id}/reschedule`)
      .set(auth(f.adminToken))
      .send({ startTime: `${secondDate}T13:00:00.000Z` })
      .expect(400);

    const leave = await prisma.staffLeave.create({
      data: {
        salonId: f.salon.id,
        branchId: f.branch.id,
        staffId: f.staff.id,
        leaveType: "PAID_LEAVE",
        startDate: new Date(`${secondDate}T00:00:00.000Z`),
        endDate: new Date(`${secondDate}T00:00:00.000Z`),
        totalDays: 1,
        status: "APPROVED",
      },
    });
    await request(app)
      .patch(`/api/appointments/${appointment.body.data.id}/reschedule`)
      .set(auth(f.adminToken))
      .send({ startTime: `${secondDate}T10:00:00.000Z` })
      .expect(400);

    await prisma.staffLeave.update({
      where: { id: leave.id },
      data: { status: "CANCELLED" },
    });
    const moved = await request(app)
      .patch(`/api/appointments/${appointment.body.data.id}/reschedule`)
      .set(auth(f.adminToken))
      .send({ startTime: `${secondDate}T10:00:00.000Z` })
      .expect(200);
    expect(moved.body.data.startTime).toBe(
      `${secondDate}T10:00:00.000Z`
    );
  });

  it("public slots prefer roster rules and exclude time blocks", async () => {
    const f = await fixture();
    const date = dateAfter(21);
    await createRule(f, date).expect(201);
    await prisma.staffTimeBlock.create({
      data: {
        salonId: f.salon.id,
        branchId: f.branch.id,
        staffId: f.staff.id,
        date: new Date(`${date}T00:00:00.000Z`),
        startTime: new Date(`${date}T10:00:00.000Z`),
        endTime: new Date(`${date}T11:00:00.000Z`),
        type: "BREAK",
      },
    });
    const response = await request(app)
      .get(`/api/public-booking/${f.setting.slug}/available-slots`)
      .query({
        branchId: f.branch.id,
        serviceIds: f.service.id,
        staffId: f.staff.id,
        date,
      })
      .expect(200);
    const starts = response.body.data.slots.map(
      (slot: { startTime: string }) => slot.startTime
    );
    expect(starts).not.toContain(`${date}T09:00:00.000Z`);
    expect(starts).not.toContain(`${date}T10:00:00.000Z`);
    expect(starts).toContain(`${date}T11:00:00.000Z`);
  });

  it("public slots fall back to legacy working hours without rules", async () => {
    const f = await fixture();
    const date = dateAfter(22);
    const response = await request(app)
      .get(`/api/public-booking/${f.setting.slug}/available-slots`)
      .query({
        branchId: f.branch.id,
        serviceIds: f.service.id,
        staffId: f.staff.id,
        date,
      })
      .expect(200);
    expect(
      response.body.data.slots.map(
        (slot: { startTime: string }) => slot.startTime
      )
    ).toContain(`${date}T09:00:00.000Z`);
  });

  // A walk-in cart is always served now, so a roster window does not bind it;
  // leave, time blocks and a clashing appointment still do.
  it("validates Job Cart staff against leave but allows carts without staff", async () => {
    const f = await fixture();
    const today = dateAfter(0);
    await prisma.staffLeave.create({
      data: {
        staffId: f.staff.id,
        salonId: f.salon.id,
        startDate: new Date(`${today}T00:00:00.000Z`),
        endDate: new Date(`${today}T00:00:00.000Z`),
        status: "APPROVED",
        leaveType: "CASUAL_LEAVE",
        totalDays: 1,
      },
    });
    const base = {
      branchId: f.branch.id,
      customerName: "Roster Walk In",
      phone: "9876543210",
      serviceIds: [f.service.id],
    };
    const onLeave = await request(app)
      .post("/api/job-carts")
      .set(auth(f.managerToken))
      .send({ ...base, staffId: f.staff.id });
    expect(onLeave.status).toBe(400);
    expect(onLeave.body.message).toMatch(/leave/i);
    await request(app)
      .post("/api/job-carts")
      .set(auth(f.managerToken))
      .send(base)
      .expect(201);
  });

  it("enforces branch-manager and staff roster scope", async () => {
    const f = await fixture();
    const date = dateAfter(24);
    await createRule(f, date).expect(201);

    await request(app)
      .get("/api/staff-availability")
      .query({ branchId: f.branch.id })
      .set(auth(f.otherManagerToken))
      .expect(404);
    await request(app)
      .post("/api/staff-availability")
      .set(auth(f.otherManagerToken))
      .send(ruleBody(f, date, { startTimeMinutes: 720, endTimeMinutes: 780 }))
      .expect(404);

    const own = await request(app)
      .get("/api/staff-availability")
      .set(auth(f.staffToken))
      .expect(200);
    expect(own.body.data).toHaveLength(1);
    await request(app)
      .get("/api/staff-availability")
      .query({ staffId: f.otherStaff.id })
      .set(auth(f.staffToken))
      .expect(404);
    await request(app)
      .post("/api/staff-availability")
      .set(auth(f.staffToken))
      .send(ruleBody(f, date))
      .expect(403);
  });

  it("rolls back availability creation when its audit fails", async () => {
    const f = await fixture();
    const date = dateAfter(25);
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_roster_rule_audit()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."module" = 'STAFF'
           AND NEW."description" LIKE 'Staff availability rule created%' THEN
          RAISE EXCEPTION 'forced roster rule audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS fail_roster_rule_audit_trigger ON "AuditLog"`
    );
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_roster_rule_audit_trigger
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION fail_roster_rule_audit()
    `);
    try {
      await createRule(f, date).expect(500);
      expect(
        await prisma.staffAvailabilityRule.count({
          where: { staffId: f.staff.id },
        })
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS fail_roster_rule_audit_trigger ON "AuditLog"`
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS fail_roster_rule_audit()`
      );
    }
  });

  it("rolls back time-block creation when its audit fails", async () => {
    const f = await fixture();
    const date = dateAfter(26);
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_roster_block_audit()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."module" = 'STAFF'
           AND NEW."description" LIKE 'Staff time block created%' THEN
          RAISE EXCEPTION 'forced roster block audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS fail_roster_block_audit_trigger ON "AuditLog"`
    );
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_roster_block_audit_trigger
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION fail_roster_block_audit()
    `);
    try {
      await request(app)
        .post("/api/staff-time-blocks")
        .set(auth(f.adminToken))
        .send(blockBody(f, date))
        .expect(500);
      expect(
        await prisma.staffTimeBlock.count({
          where: { staffId: f.staff.id },
        })
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS fail_roster_block_audit_trigger ON "AuditLog"`
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS fail_roster_block_audit()`
      );
    }
  });
});
