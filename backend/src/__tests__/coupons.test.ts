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

const couponBody = (overrides: Record<string, unknown> = {}) => ({
  couponCode: `SAVE-${randomUUID()}`,
  name: "Seasonal offer",
  discountPercentage: 10,
  validFrom: "2025-01-01T00:00:00.000Z",
  validUntil: "2099-12-31T23:59:59.000Z",
  ...overrides,
});

const fixture = async () => {
  const stamp = randomUUID();
  const salonA = await prisma.salon.create({
    data: { name: `Coupon Salon A ${stamp}` },
  });
  const salonB = await prisma.salon.create({
    data: { name: `Coupon Salon B ${stamp}` },
  });
  const branchA = await prisma.branch.create({
    data: { name: `Coupon Branch A ${stamp}`, salonId: salonA.id },
  });
  const branchA2 = await prisma.branch.create({
    data: { name: `Coupon Branch A2 ${stamp}`, salonId: salonA.id },
  });
  const branchB = await prisma.branch.create({
    data: { name: `Coupon Branch B ${stamp}`, salonId: salonB.id },
  });
  const [superAdmin, adminA, adminB, receptionist, staff] =
    await Promise.all([
      prisma.user.create({
        data: {
          name: "Coupon Super",
          email: `coupon-super-${stamp}@test.com`,
          passwordHash: "unused",
          role: "SUPER_ADMIN",
        },
      }),
      prisma.user.create({
        data: {
          name: "Coupon Admin A",
          email: `coupon-admin-a-${stamp}@test.com`,
          passwordHash: "unused",
          role: "SALON_ADMIN",
          salonId: salonA.id,
        },
      }),
      prisma.user.create({
        data: {
          name: "Coupon Admin B",
          email: `coupon-admin-b-${stamp}@test.com`,
          passwordHash: "unused",
          role: "SALON_ADMIN",
          salonId: salonB.id,
        },
      }),
      prisma.user.create({
        data: {
          name: "Coupon Receptionist",
          email: `coupon-reception-${stamp}@test.com`,
          passwordHash: "unused",
          role: "RECEPTIONIST",
          salonId: salonA.id,
          branchId: branchA.id,
        },
      }),
      prisma.user.create({
        data: {
          name: "Coupon Staff",
          email: `coupon-staff-${stamp}@test.com`,
          passwordHash: "unused",
          role: "STAFF",
          salonId: salonA.id,
          branchId: branchA.id,
        },
      }),
    ]);
  const customer = await prisma.customer.create({
    data: {
      customerCode: `COUPON-${stamp}`,
      name: "Coupon Customer",
      phone: `9${stamp.replaceAll("-", "").slice(0, 9)}`,
      salonId: salonA.id,
      branchId: branchA.id,
      outstandingAmount: 106.2,
      loyaltyPoints: 100,
    },
  });
  const invoice = await prisma.invoice.create({
    data: {
      invoiceCode: `DRAFT-${stamp}`,
      salonId: salonA.id,
      branchId: branchA.id,
      customerId: customer.id,
      salonName: salonA.name,
      customerName: customer.name,
      invoiceType: "GST_INVOICE",
      subtotalAmount: 100,
      discountAmount: 10,
      taxAmount: 16.2,
      totalAmount: 106.2,
      balanceAmount: 106.2,
      status: "DRAFT",
      paymentStatus: "UNPAID",
      items: {
        create: {
          description: "Service",
          serviceName: "Service",
          unitPrice: 100,
          taxPercent: 18,
          taxAmount: 18,
          lineTotal: 118,
        },
      },
    },
  });
  return {
    salonA,
    salonB,
    branchA,
    branchA2,
    branchB,
    customer,
    invoice,
    superToken: tokenFor(superAdmin),
    adminAToken: tokenFor(adminA),
    adminBToken: tokenFor(adminB),
    receptionistToken: tokenFor(receptionist),
    staffToken: tokenFor(staff),
  };
};

const installAuditFailureTrigger = async () => {
  await prisma.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION fail_audit_insert() RETURNS trigger AS $$ BEGIN IF NEW."entityName" LIKE 'FORCE_AUDIT_FAILURE%' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`
  );
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS force_audit_failure ON "AuditLog"`
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER force_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fail_audit_insert()`
  );
};

describe("discount coupons", () => {
  it("creates, validates, isolates and deduplicates coupons", async () => {
    const f = await fixture();
    const body = couponBody({ couponCode: " summer10 " });
    const created = await request(app)
      .post("/api/coupons")
      .set(auth(f.adminAToken))
      .send(body);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      salonId: f.salonA.id,
      couponCode: "SUMMER10",
      isActive: true,
    });
    expect(
      await prisma.auditLog.count({
        where: {
          module: "COUPON",
          action: "CREATE",
          entityId: created.body.data.id,
        },
      })
    ).toBe(1);

    await request(app)
      .post("/api/coupons")
      .set(auth(f.adminAToken))
      .send(couponBody({ couponCode: "summer10" }))
      .expect(409);

    const otherSalon = await request(app)
      .post("/api/coupons")
      .set(auth(f.adminBToken))
      .send(couponBody({ couponCode: "SUMMER10" }));
    expect(otherSalon.status).toBe(201);
    expect(otherSalon.body.data.salonId).toBe(f.salonB.id);

    await request(app)
      .post("/api/coupons")
      .set(auth(f.adminAToken))
      .send(couponBody({ discountPercentage: 101 }))
      .expect(400);
    await request(app)
      .post("/api/coupons")
      .set(auth(f.adminAToken))
      .send(
        couponBody({
          validFrom: "2030-02-01T00:00:00.000Z",
          validUntil: "2030-01-01T00:00:00.000Z",
        })
      )
      .expect(400);
  });

  it("paginates and filters coupons while enforcing role access", async () => {
    const f = await fixture();
    await prisma.coupon.createMany({
      data: [
        {
          salonId: f.salonA.id,
          couponCode: "ACTIVE-A",
          discountPercentage: 10,
          validFrom: new Date("2025-01-01"),
          validUntil: new Date("2099-01-01"),
        },
        {
          salonId: f.salonA.id,
          couponCode: "INACTIVE-A",
          discountPercentage: 15,
          validFrom: new Date("2025-01-01"),
          validUntil: new Date("2099-01-01"),
          isActive: false,
        },
        {
          salonId: f.salonB.id,
          couponCode: "OTHER-SALON",
          discountPercentage: 20,
          validFrom: new Date("2025-01-01"),
          validUntil: new Date("2099-01-01"),
        },
      ],
    });

    const page = await request(app)
      .get("/api/coupons?page=1&limit=1")
      .set(auth(f.adminAToken));
    expect(page.status).toBe(200);
    expect(page.body.data).toHaveLength(1);
    expect(page.body.pagination).toEqual({
      page: 1,
      limit: 1,
      total: 2,
      totalPages: 2,
    });

    const active = await request(app)
      .get("/api/coupons?isActive=true&search=ACTIVE-A")
      .set(auth(f.adminAToken));
    expect(active.status).toBe(200);
    expect(active.body.data).toHaveLength(1);
    expect(active.body.data[0].couponCode).toBe("ACTIVE-A");

    await request(app)
      .get("/api/coupons")
      .set(auth(f.staffToken))
      .expect(403);
  });

  it("allows receptionist viewing and applying but blocks management", async () => {
    const f = await fixture();
    const coupon = await prisma.coupon.create({
      data: {
        salonId: f.salonA.id,
        branchId: f.branchA.id,
        couponCode: "FRONTDESK",
        discountPercentage: 10,
        validFrom: new Date("2025-01-01"),
        validUntil: new Date("2099-01-01"),
      },
    });

    const list = await request(app)
      .get("/api/coupons")
      .set(auth(f.receptionistToken));
    expect(list.status).toBe(200);
    expect(list.body.data.map((item: { id: string }) => item.id)).toContain(
      coupon.id
    );

    await request(app)
      .post(`/api/invoices/${f.invoice.id}/apply-coupon`)
      .set(auth(f.receptionistToken))
      .send({ couponCode: coupon.couponCode })
      .expect(200);
    await request(app)
      .post("/api/coupons")
      .set(auth(f.receptionistToken))
      .send(couponBody())
      .expect(403);
  });

  it("applies and removes a coupon with Decimal-safe totals and ledger updates", async () => {
    const f = await fixture();
    const coupon = await prisma.coupon.create({
      data: {
        salonId: f.salonA.id,
        couponCode: "TENOFF",
        discountPercentage: 10,
        validFrom: new Date("2025-01-01"),
        validUntil: new Date("2099-01-01"),
      },
    });

    const applied = await request(app)
      .post(`/api/invoices/${f.invoice.id}/apply-coupon`)
      .set(auth(f.adminAToken))
      .send({ couponCode: " tenoff " });
    expect(applied.status).toBe(200);
    expect(applied.body.data.couponId).toBe(coupon.id);
    expect(Number(applied.body.data.discountAmount)).toBe(10);
    expect(Number(applied.body.data.couponDiscountAmount)).toBe(9);
    expect(Number(applied.body.data.taxAmount)).toBe(14.58);
    // 95.58 rounded to whole rupees, with the 0.42 kept as the round-off.
    expect(Number(applied.body.data.roundOffAmount)).toBe(0.42);
    expect(Number(applied.body.data.totalAmount)).toBe(96);
    expect(
      Number(
        (
          await prisma.customer.findUniqueOrThrow({
            where: { id: f.customer.id },
          })
        ).outstandingAmount
      )
    ).toBe(96);

    const removed = await request(app)
      .post(`/api/invoices/${f.invoice.id}/remove-coupon`)
      .set(auth(f.adminAToken));
    expect(removed.status).toBe(200);
    expect(removed.body.data.couponId).toBeNull();
    expect(Number(removed.body.data.couponDiscountAmount)).toBe(0);
    // Recalculated without the coupon: 106.20 rounded to whole rupees.
    expect(Number(removed.body.data.roundOffAmount)).toBe(-0.2);
    expect(Number(removed.body.data.totalAmount)).toBe(106);
  });

  it("counts coupon usage when issuing and reverses it on cancellation", async () => {
    const f = await fixture();
    const coupon = await prisma.coupon.create({
      data: {
        salonId: f.salonA.id,
        couponCode: "LIMITED",
        discountPercentage: 5,
        validFrom: new Date("2025-01-01"),
        validUntil: new Date("2099-01-01"),
        maxUsageCount: 1,
      },
    });
    await request(app)
      .post(`/api/invoices/${f.invoice.id}/apply-coupon`)
      .set(auth(f.adminAToken))
      .send({ couponCode: coupon.couponCode })
      .expect(200);
    await request(app)
      .patch(`/api/invoices/${f.invoice.id}/issue`)
      .set(auth(f.adminAToken))
      .expect(200);
    expect(
      (await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } }))
        .usedCount
    ).toBe(1);

    await request(app)
      .patch(`/api/invoices/${f.invoice.id}/cancel`)
      .set(auth(f.adminAToken))
      .expect(200);
    expect(
      (await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } }))
        .usedCount
    ).toBe(0);
  });

  it("enforces validity, usage, minimum amount, salon and branch rules", async () => {
    const f = await fixture();
    const base = {
      discountPercentage: 10,
      validFrom: new Date("2025-01-01"),
      validUntil: new Date("2099-01-01"),
    };
    const coupons = await Promise.all([
      prisma.coupon.create({
        data: {
          salonId: f.salonA.id,
          couponCode: "INACTIVE",
          ...base,
          isActive: false,
        },
      }),
      prisma.coupon.create({
        data: {
          salonId: f.salonA.id,
          couponCode: "EXPIRED",
          ...base,
          validUntil: new Date("2025-02-01"),
        },
      }),
      prisma.coupon.create({
        data: {
          salonId: f.salonA.id,
          couponCode: "FUTURE",
          ...base,
          validFrom: new Date("2098-01-01"),
        },
      }),
      prisma.coupon.create({
        data: {
          salonId: f.salonA.id,
          couponCode: "USEDUP",
          ...base,
          maxUsageCount: 1,
          usedCount: 1,
        },
      }),
      prisma.coupon.create({
        data: {
          salonId: f.salonA.id,
          couponCode: "MINIMUM",
          ...base,
          minInvoiceAmount: 1000,
        },
      }),
      prisma.coupon.create({
        data: {
          salonId: f.salonA.id,
          branchId: f.branchA2.id,
          couponCode: "WRONG-BRANCH",
          ...base,
        },
      }),
      prisma.coupon.create({
        data: {
          salonId: f.salonB.id,
          couponCode: "OTHER-SALON",
          ...base,
        },
      }),
    ]);

    for (const coupon of coupons) {
      const response = await request(app)
        .post(`/api/invoices/${f.invoice.id}/apply-coupon`)
        .set(auth(f.adminAToken))
        .send({ couponCode: coupon.couponCode });
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
  });

  it("rejects coupon changes on paid, issued and cancelled invoices", async () => {
    const f = await fixture();
    const coupon = await prisma.coupon.create({
      data: {
        salonId: f.salonA.id,
        couponCode: "LOCKED",
        discountPercentage: 10,
        validFrom: new Date("2025-01-01"),
        validUntil: new Date("2099-01-01"),
      },
    });
    for (const state of [
      { status: "ISSUED" as const, paymentStatus: "UNPAID" as const },
      { status: "ISSUED" as const, paymentStatus: "PAID" as const },
      { status: "CANCELLED" as const, paymentStatus: "UNPAID" as const },
    ]) {
      await prisma.invoice.update({
        where: { id: f.invoice.id },
        data: state,
      });
      const response = await request(app)
        .post(`/api/invoices/${f.invoice.id}/apply-coupon`)
        .set(auth(f.adminAToken))
        .send({ couponCode: coupon.couponCode });
      expect(response.status).toBe(409);
    }
  });

  it("soft-deletes used coupons and blocks cross-salon access", async () => {
    const f = await fixture();
    const coupon = await prisma.coupon.create({
      data: {
        salonId: f.salonA.id,
        couponCode: "USED",
        discountPercentage: 10,
        validFrom: new Date("2025-01-01"),
        validUntil: new Date("2099-01-01"),
        usedCount: 1,
      },
    });

    await request(app)
      .get(`/api/coupons/${coupon.id}`)
      .set(auth(f.adminBToken))
      .expect(404);
    const removed = await request(app)
      .delete(`/api/coupons/${coupon.id}`)
      .set(auth(f.adminAToken));
    expect(removed.status).toBe(200);
    expect(removed.body.data.isActive).toBe(false);
    expect(
      (await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } }))
        .isActive
    ).toBe(false);
  });

  it("rolls back coupon creation and application when audit insertion fails", async () => {
    const f = await fixture();
    await installAuditFailureTrigger();

    await request(app)
      .post("/api/coupons")
      .set(auth(f.adminAToken))
      .send(
        couponBody({
          couponCode: "FORCE_AUDIT_FAILURE_CREATE",
        })
      )
      .expect(500);
    expect(
      await prisma.coupon.count({
        where: {
          salonId: f.salonA.id,
          couponCode: "FORCE_AUDIT_FAILURE_CREATE",
        },
      })
    ).toBe(0);

    await prisma.coupon.create({
      data: {
        salonId: f.salonA.id,
        couponCode: "FORCE_AUDIT_FAILURE_APPLY",
        discountPercentage: 10,
        validFrom: new Date("2025-01-01"),
        validUntil: new Date("2099-01-01"),
      },
    });
    await request(app)
      .post(`/api/invoices/${f.invoice.id}/apply-coupon`)
      .set(auth(f.adminAToken))
      .send({ couponCode: "FORCE_AUDIT_FAILURE_APPLY" })
      .expect(500);

    const unchanged = await prisma.invoice.findUniqueOrThrow({
      where: { id: f.invoice.id },
    });
    expect(unchanged.couponId).toBeNull();
    expect(Number(unchanged.totalAmount)).toBe(106.2);
    expect(
      Number(
        (
          await prisma.customer.findUniqueOrThrow({
            where: { id: f.customer.id },
          })
        ).outstandingAmount
      )
    ).toBe(106.2);
  });
});
