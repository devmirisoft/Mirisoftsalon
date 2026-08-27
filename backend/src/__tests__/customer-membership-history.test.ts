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

const fixture = async () => {
  const marker = randomUUID();
  const salon = await prisma.salon.create({
    data: { name: `History Salon ${marker}` },
  });
  const otherSalon = await prisma.salon.create({
    data: { name: `Other History Salon ${marker}` },
  });
  const branch = await prisma.branch.create({
    data: { salonId: salon.id, name: `History Main ${marker}` },
  });
  const otherBranch = await prisma.branch.create({
    data: { salonId: salon.id, name: `History Other ${marker}` },
  });
  const [admin, receptionist, otherReceptionist, staff, foreignAdmin] =
    await Promise.all([
      prisma.user.create({
        data: {
          name: "History Admin",
          email: `history-admin-${marker}@test.com`,
          passwordHash: "test",
          role: "SALON_ADMIN",
          salonId: salon.id,
        },
      }),
      prisma.user.create({
        data: {
          name: "History Receptionist",
          email: `history-reception-${marker}@test.com`,
          passwordHash: "test",
          role: "RECEPTIONIST",
          salonId: salon.id,
          branchId: branch.id,
        },
      }),
      prisma.user.create({
        data: {
          name: "Other History Receptionist",
          email: `history-other-reception-${marker}@test.com`,
          passwordHash: "test",
          role: "RECEPTIONIST",
          salonId: salon.id,
          branchId: otherBranch.id,
        },
      }),
      prisma.user.create({
        data: {
          name: "History Staff",
          email: `history-staff-${marker}@test.com`,
          passwordHash: "test",
          role: "STAFF",
          salonId: salon.id,
          branchId: branch.id,
        },
      }),
      prisma.user.create({
        data: {
          name: "Foreign History Admin",
          email: `history-foreign-${marker}@test.com`,
          passwordHash: "test",
          role: "SALON_ADMIN",
          salonId: otherSalon.id,
        },
      }),
    ]);
  const [customer, otherBranchCustomer] = await Promise.all([
    prisma.customer.create({
      data: {
        customerCode: `HIS-${marker}`,
        name: "History Customer",
        phone: `91${marker.replace(/\D/g, "").slice(0, 8).padEnd(8, "1")}`,
        salonId: salon.id,
        branchId: branch.id,
      },
    }),
    prisma.customer.create({
      data: {
        customerCode: `HIS-OTHER-${marker}`,
        name: "Other Branch Customer",
        phone: `92${marker.replace(/\D/g, "").slice(0, 8).padEnd(8, "2")}`,
        salonId: salon.id,
        branchId: otherBranch.id,
      },
    }),
  ]);
  const [silver, gold] = await Promise.all([
    prisma.membership.create({
      data: {
        salonId: salon.id,
        name: `Silver ${marker}`,
        discountPercentage: 10,
      },
    }),
    prisma.membership.create({
      data: {
        salonId: salon.id,
        name: `Gold ${marker}`,
        discountPercentage: 20,
      },
    }),
  ]);
  const mainService = await prisma.mainService.create({
    data: { salonId: salon.id, name: `History Service ${marker}` },
  });
  const service = await prisma.service.create({
    data: {
      salonId: salon.id,
      branchId: branch.id,
      mainServiceId: mainService.id,
      name: `History Facial ${marker}`,
      price: 1000,
      durationValue: 60,
    },
  });
  const stylist = await prisma.staff.create({
    data: {
      salonId: salon.id,
      branchId: branch.id,
      name: "History Stylist",
      email: `history-stylist-${marker}@test.com`,
      jobRole: "Stylist",
      workingFrom: "09:00",
      workingTo: "18:00",
      weekOff: "Sunday",
    },
  });
  return {
    salon,
    branch,
    customer,
    otherBranchCustomer,
    silver,
    gold,
    service,
    stylist,
    adminToken: tokenFor(admin),
    receptionistToken: tokenFor(receptionist),
    otherReceptionistToken: tokenFor(otherReceptionist),
    staffToken: tokenFor(staff),
    foreignAdminToken: tokenFor(foreignAdmin),
  };
};

const assign = (
  f: Awaited<ReturnType<typeof fixture>>,
  body: Record<string, unknown>,
  token = f.adminToken,
  customerId = f.customer.id
) =>
  request(app)
    .post(`/api/customers/${customerId}/memberships`)
    .set(auth(token))
    .send(body);

/**
 * Seeds a membership that already started, and optionally already elapsed.
 * The assignment endpoint refuses start and expiry dates in the past, so a
 * scenario that needs a lapsed membership has to be written directly rather
 * than through the API.
 */
const seedMembership = async (
  f: Awaited<ReturnType<typeof fixture>>,
  input: {
    membership: { id: string; name: string; discountPercentage: unknown };
    startsAt: Date;
    expiresAt: Date | null;
    customerId?: string;
    branchId?: string | null;
  }
) => {
  const customerId = input.customerId ?? f.customer.id;
  const created = await prisma.customerMembership.create({
    data: {
      salonId: f.salon.id,
      branchId: input.branchId === undefined ? f.branch.id : input.branchId,
      customerId,
      membershipId: input.membership.id,
      membershipNameSnapshot: input.membership.name,
      discountPercentageSnapshot:
        input.membership.discountPercentage as never,
      startsAt: input.startsAt,
      expiresAt: input.expiresAt,
      status: "ACTIVE",
    },
  });
  await prisma.customer.update({
    where: { id: customerId },
    data: { membershipId: input.membership.id },
  });
  return created;
};

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const createInvoice = async (
  f: Awaited<ReturnType<typeof fixture>>,
  suffix: string
) => {
  const appointment = await prisma.appointment.create({
    data: {
      appointmentCode: `HIS-APT-${suffix}-${randomUUID()}`,
      salonId: f.salon.id,
      branchId: f.branch.id,
      customerId: f.customer.id,
      staffId: f.stylist.id,
      startTime: new Date(`2038-01-${suffix}T10:00:00.000Z`),
      endTime: new Date(`2038-01-${suffix}T11:00:00.000Z`),
      totalDurationMinutes: 60,
      estimatedAmount: 1000,
      status: "COMPLETED",
      services: {
        create: {
          serviceId: f.service.id,
          serviceName: f.service.name,
          price: 1000,
          durationValue: 60,
          durationUnit: "MINUTES",
        },
      },
    },
  });
  return request(app)
    .post(`/api/invoices/from-appointment/${appointment.id}`)
    .set(auth(f.adminToken))
    .send({ invoiceType: "BILL_OF_SUPPLY" });
};

describe("Customer membership lifecycle history", () => {
  it("assigns an expiring membership and returns current detail and history", async () => {
    const f = await fixture();
    const response = await assign(f, {
      membershipId: f.silver.id,
      expiresAt: "2030-12-02T23:59:59.000Z",
      note: "Annual silver plan",
    });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      membershipId: f.silver.id,
      status: "ACTIVE",
      membershipNameSnapshot: f.silver.name,
      note: "Annual silver plan",
    });

    const detail = await request(app)
      .get(`/api/customers/${f.customer.id}`)
      .set(auth(f.adminToken));
    expect(detail.status).toBe(200);
    expect(detail.body.data.currentMembership).toMatchObject({
      id: response.body.data.id,
      membershipId: f.silver.id,
      membershipName: f.silver.name,
      status: "ACTIVE",
    });
    expect(detail.body.data.membershipExpiresAt).toBe(
      "2030-12-02T23:59:59.000Z"
    );

    const history = await request(app)
      .get(`/api/customers/${f.customer.id}/memberships`)
      .set(auth(f.adminToken));
    expect(history.status).toBe(200);
    expect(history.body.data).toHaveLength(1);
  });

  it("renews a membership and closes the previous active record", async () => {
    const f = await fixture();
    const first = await assign(f, { membershipId: f.silver.id });
    const second = await assign(f, {
      membershipId: f.gold.id,
      expiresAt: "2031-01-01T00:00:00.000Z",
    });
    expect(second.status).toBe(201);
    const rows = await prisma.customerMembership.findMany({
      where: { customerId: f.customer.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === first.body.data.id)?.status).toBe(
      "REMOVED"
    );
    expect(rows.find((row) => row.id === second.body.data.id)?.status).toBe(
      "ACTIVE"
    );
    expect(
      (
        await prisma.customer.findUniqueOrThrow({
          where: { id: f.customer.id },
        })
      ).membershipId
    ).toBe(f.gold.id);
  });

  it("removes membership access and no longer applies its invoice discount", async () => {
    const f = await fixture();
    const assigned = await assign(f, { membershipId: f.silver.id });
    await request(app)
      .patch(`/api/customer-memberships/${assigned.body.data.id}/remove`)
      .set(auth(f.adminToken))
      .expect(200);
    const invoice = await createInvoice(f, "10");
    expect(invoice.status).toBe(201);
    expect(Number(invoice.body.data.membershipDiscountAmount)).toBe(0);
  });

  it("expires an elapsed membership and excludes it from invoice discounts", async () => {
    const f = await fixture();
    await seedMembership(f, {
      membership: f.silver,
      startsAt: daysAgo(400),
      expiresAt: daysAgo(30),
    });
    const invoice = await createInvoice(f, "11");
    expect(invoice.status).toBe(201);
    expect(Number(invoice.body.data.membershipDiscountAmount)).toBe(0);
    const history = await prisma.customerMembership.findFirstOrThrow({
      where: { customerId: f.customer.id },
    });
    expect(history.status).toBe("EXPIRED");
    expect(
      (
        await prisma.customer.findUniqueOrThrow({
          where: { id: f.customer.id },
        })
      ).membershipId
    ).toBeNull();
  });

  it("counts only currently valid memberships as active customers", async () => {
    const f = await fixture();
    await seedMembership(f, {
      membership: f.silver,
      startsAt: daysAgo(400),
      expiresAt: daysAgo(30),
    });
    await assign(
      f,
      {
        membershipId: f.gold.id,
        expiresAt: "2040-01-01T00:00:00.000Z",
      },
      f.adminToken,
      f.otherBranchCustomer.id
    );

    const response = await request(app)
      .get("/api/memberships")
      .set(auth(f.adminToken))
      .expect(200);
    const silver = response.body.data.find(
      (row: { id: string }) => row.id === f.silver.id
    );
    const gold = response.body.data.find(
      (row: { id: string }) => row.id === f.gold.id
    );

    expect(silver._count).toMatchObject({
      customers: 0,
      customerMemberships: 0,
    });
    expect(gold._count).toMatchObject({
      customers: 0,
      customerMemberships: 1,
    });
  });

  it("soft-deletes a membership that has expired customer history", async () => {
    const f = await fixture();
    await seedMembership(f, {
      membership: f.silver,
      startsAt: daysAgo(400),
      expiresAt: daysAgo(30),
    });

    const response = await request(app)
      .delete(`/api/memberships/${f.silver.id}`)
      .set(auth(f.adminToken))
      .expect(200);

    expect(response.body.data.status).toBe(false);
    expect(
      await prisma.membership.findUnique({ where: { id: f.silver.id } })
    ).not.toBeNull();
  });

  it("continues applying a non-expired membership discount", async () => {
    const f = await fixture();
    await assign(f, {
      membershipId: f.silver.id,
      expiresAt: "2040-01-01T00:00:00.000Z",
    });
    const invoice = await createInvoice(f, "12");
    expect(invoice.status).toBe(201);
    expect(Number(invoice.body.data.membershipDiscountAmount)).toBe(100);
  });

  it("returns membership expiry and status in the Job Cart summary", async () => {
    const f = await fixture();
    const expiry = "2040-12-02T00:00:00.000Z";
    const assigned = await assign(f, {
      membershipId: f.silver.id,
      expiresAt: expiry,
    });
    const summary = await request(app)
      .get("/api/job-carts/customer-summary")
      .query({ customerId: f.customer.id })
      .set(auth(f.adminToken));
    expect(summary.status).toBe(200);
    expect(summary.body.data).toMatchObject({
      membershipName: f.silver.name,
      membershipExpiresAt: expiry,
      membershipStatus: "ACTIVE",
      currentCustomerMembershipId: assigned.body.data.id,
    });
  });

  it("enforces salon, receptionist branch, and staff access", async () => {
    const f = await fixture();
    expect(
      (
        await assign(
          f,
          { membershipId: f.silver.id },
          f.otherReceptionistToken
        )
      ).status
    ).toBe(404);
    expect(
      (
        await assign(
          f,
          { membershipId: f.silver.id },
          f.receptionistToken,
          f.otherBranchCustomer.id
        )
      ).status
    ).toBe(404);
    expect(
      (await assign(f, { membershipId: f.silver.id }, f.staffToken)).status
    ).toBe(403);
    await assign(f, { membershipId: f.silver.id });
    const foreignList = await request(app)
      .get("/api/customer-memberships")
      .set(auth(f.foreignAdminToken));
    expect(foreignList.status).toBe(200);
    expect(foreignList.body.data).toHaveLength(0);
  });

  it("rolls back assignment when its audit fails", async () => {
    const f = await fixture();
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_membership_assignment_audit()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."module" = 'MEMBERSHIP'
           AND NEW."description" LIKE 'Customer membership % assigned' THEN
          RAISE EXCEPTION 'forced membership assignment audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS fail_membership_assignment_audit_trigger ON "AuditLog"`
    );
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_membership_assignment_audit_trigger
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION fail_membership_assignment_audit()
    `);
    try {
      await assign(f, { membershipId: f.silver.id }).then((response) =>
        expect(response.status).toBe(500)
      );
      expect(
        await prisma.customerMembership.count({
          where: { customerId: f.customer.id },
        })
      ).toBe(0);
      expect(
        (
          await prisma.customer.findUniqueOrThrow({
            where: { id: f.customer.id },
          })
        ).membershipId
      ).toBeNull();
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS fail_membership_assignment_audit_trigger ON "AuditLog"`
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS fail_membership_assignment_audit()`
      );
    }
  });

  it.each(["remove", "cancel"] as const)(
    "rolls back %s when its audit fails",
    async (action) => {
      const f = await fixture();
      const assigned = await assign(f, { membershipId: f.silver.id });
      const auditVerb = action === "remove" ? "removed" : "cancelled";
      await prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION fail_membership_end_audit()
        RETURNS trigger AS $$
        BEGIN
          IF NEW."module" = 'MEMBERSHIP'
             AND NEW."description" LIKE 'Customer membership % ${auditVerb}' THEN
            RAISE EXCEPTION 'forced membership end audit failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS fail_membership_end_audit_trigger ON "AuditLog"`
      );
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER fail_membership_end_audit_trigger
        BEFORE INSERT ON "AuditLog"
        FOR EACH ROW EXECUTE FUNCTION fail_membership_end_audit()
      `);
      try {
        await request(app)
          .patch(
            `/api/customer-memberships/${assigned.body.data.id}/${action}`
          )
          .set(auth(f.adminToken))
          .expect(500);
        expect(
          (
            await prisma.customerMembership.findUniqueOrThrow({
              where: { id: assigned.body.data.id },
            })
          ).status
        ).toBe("ACTIVE");
        expect(
          (
            await prisma.customer.findUniqueOrThrow({
              where: { id: f.customer.id },
            })
          ).membershipId
        ).toBe(f.silver.id);
      } finally {
        await prisma.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS fail_membership_end_audit_trigger ON "AuditLog"`
        );
        await prisma.$executeRawUnsafe(
          `DROP FUNCTION IF EXISTS fail_membership_end_audit()`
        );
      }
    }
  );
});
