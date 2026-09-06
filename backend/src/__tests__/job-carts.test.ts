import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { app } from "../app.js";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";

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

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const fixture = async () => {
  const marker = randomUUID();
  const salon = await prisma.salon.create({
    data: { name: `Job Cart Salon ${marker}` },
  });
  const otherSalon = await prisma.salon.create({
    data: { name: `Other Job Cart Salon ${marker}` },
  });
  const branch = await prisma.branch.create({
    data: { name: `Main ${marker}`, salonId: salon.id },
  });
  const otherBranch = await prisma.branch.create({
    data: { name: `Second ${marker}`, salonId: salon.id },
  });
  const foreignBranch = await prisma.branch.create({
    data: { name: `Foreign ${marker}`, salonId: otherSalon.id },
  });
  const admin = await prisma.user.create({
    data: {
      name: "Job Cart Admin",
      email: `job-admin-${marker}@test.com`,
      passwordHash: "test",
      role: "SALON_ADMIN",
      salonId: salon.id,
    },
  });
  const otherAdmin = await prisma.user.create({
    data: {
      name: "Other Admin",
      email: `other-job-admin-${marker}@test.com`,
      passwordHash: "test",
      role: "SALON_ADMIN",
      salonId: otherSalon.id,
    },
  });
  const receptionist = await prisma.user.create({
    data: {
      name: "Main Receptionist",
      email: `job-reception-${marker}@test.com`,
      passwordHash: "test",
      role: "RECEPTIONIST",
      salonId: salon.id,
      branchId: branch.id,
    },
  });
  const otherReceptionist = await prisma.user.create({
    data: {
      name: "Other Receptionist",
      email: `other-reception-${marker}@test.com`,
      passwordHash: "test",
      role: "RECEPTIONIST",
      salonId: salon.id,
      branchId: otherBranch.id,
    },
  });
  const staffUser = await prisma.user.create({
    data: {
      name: "Blocked Staff",
      email: `blocked-staff-${marker}@test.com`,
      passwordHash: "test",
      role: "STAFF",
      salonId: salon.id,
      branchId: branch.id,
    },
  });
  const stylist = await prisma.staff.create({
    data: {
      name: "Walk-in Stylist",
      email: `walk-in-stylist-${marker}@test.com`,
      jobRole: "Stylist",
      workingFrom: "09:00",
      workingTo: "20:00",
      weekOff: "NEVER",
      salonId: salon.id,
      branchId: branch.id,
    },
  });
  const category = await prisma.mainService.create({
    data: { name: `Walk-in Services ${marker}`, salonId: salon.id },
  });
  const service = await prisma.service.create({
    data: {
      name: `Walk-in Haircut ${marker}`,
      price: 500,
      durationValue: 45,
      durationUnit: "MINUTES",
      salonId: salon.id,
      branchId: branch.id,
      mainServiceId: category.id,
    },
  });
  const secondService = await prisma.service.create({
    data: {
      name: `Walk-in Styling ${marker}`,
      price: 300,
      durationValue: 30,
      durationUnit: "MINUTES",
      salonId: salon.id,
      branchId: branch.id,
      mainServiceId: category.id,
    },
  });
  const product = await prisma.product.create({
    data: {
      name: `Walk-in Consumable ${marker}`,
      salonId: salon.id,
      branchId: branch.id,
      currentStock: 10,
      isServiceConsumable: true,
    },
  });
  await prisma.serviceConsumable.create({
    data: {
      salonId: salon.id,
      serviceId: service.id,
      productId: product.id,
      quantity: 2,
    },
  });
  return {
    salon,
    otherSalon,
    branch,
    otherBranch,
    foreignBranch,
    adminToken: tokenFor(admin),
    otherAdminToken: tokenFor(otherAdmin),
    receptionistToken: tokenFor(receptionist),
    otherReceptionistToken: tokenFor(otherReceptionist),
    staffToken: tokenFor(staffUser),
    stylist,
    service,
    secondService,
    product,
  };
};

const createCart = (
  f: Awaited<ReturnType<typeof fixture>>,
  token = f.adminToken,
  overrides: Record<string, unknown> = {}
) =>
  request(app)
    .post("/api/job-carts")
    .set(auth(token))
    .send({
      branchId: f.branch.id,
      customerName: "Walk-in Customer",
      phone: "98765 43210",
      startTime: "2038-01-01T10:00:00.000Z",
      serviceIds: [f.service.id],
      ...overrides,
    });

describe("Walk-in job carts", () => {
  it("creates or reuses a customer and creates a walk-in appointment with a draft invoice", async () => {
    const f = await fixture();
    const existing = await prisma.customer.create({
      data: {
        customerCode: `JC-${randomUUID()}`,
        name: "Existing Walk-in",
        phone: "+91 98765 43210",
        salonId: f.salon.id,
        branchId: f.branch.id,
      },
    });
    const response = await createCart(f, f.receptionistToken, {
      customerName: "Existing Walk-in",
      phone: "+91-98765-43210",
      serviceIds: [],
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      customerId: existing.id,
      staffId: null,
      status: "ACTIVE",
      appointmentStatus: "SCHEDULED",
      source: "WALK_IN",
      items: [],
      invoice: {
        status: "DRAFT",
        paymentStatus: "UNPAID",
      },
    });
    expect(
      await prisma.appointment.findUnique({
        where: { id: response.body.data.id },
        select: { walkInJobCart: true, source: true },
      })
    ).toEqual({ walkInJobCart: true, source: "WALK_IN" });
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: response.body.data.id,
          module: "JOB_CART",
          action: "CREATE",
        },
      })
    ).toBe(1);
  });

  it("adds and removes services while keeping appointment and draft invoice totals synchronized", async () => {
    const f = await fixture();
    const created = await createCart(f);
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const added = await request(app)
      .post(`/api/job-carts/${id}/items`)
      .set(auth(f.adminToken))
      .send({ serviceId: f.secondService.id });
    expect(added.status).toBe(200);
    expect(added.body.data.items).toHaveLength(2);
    expect(Number(added.body.data.estimatedAmount)).toBe(800);
    expect(Number(added.body.data.invoice.subtotalAmount)).toBe(800);
    expect(Number(added.body.data.invoice.totalAmount)).toBe(800);
    expect(added.body.data.totalDurationMinutes).toBe(75);

    const removable = added.body.data.items.find(
      (item: { serviceId: string }) => item.serviceId === f.secondService.id
    );
    const removed = await request(app)
      .delete(`/api/job-carts/${id}/items/${removable.id}`)
      .set(auth(f.adminToken));
    expect(removed.status).toBe(200);
    expect(removed.body.data.items).toHaveLength(1);
    expect(Number(removed.body.data.invoice.totalAmount)).toBe(500);
  });

  it("reprices a service line and assigns its staff, keeping the draft invoice in step", async () => {
    const f = await fixture();
    const created = await createCart(f);
    const id = created.body.data.id as string;
    const line = created.body.data.items[0];

    const priced = await request(app)
      .patch(`/api/job-carts/${id}/items/${line.id}`)
      .set(auth(f.adminToken))
      .send({ price: 650, staffId: f.stylist.id });
    expect(priced.status).toBe(200);
    const updated = priced.body.data.items.find(
      (item: { id: string }) => item.id === line.id
    );
    expect(Number(updated.price)).toBe(650);
    expect(updated.staffId).toBe(f.stylist.id);
    expect(Number(priced.body.data.invoice.subtotalAmount)).toBe(650);
    expect(Number(priced.body.data.invoice.totalAmount)).toBe(650);

    const cleared = await request(app)
      .patch(`/api/job-carts/${id}/items/${line.id}`)
      .set(auth(f.adminToken))
      .send({ staffId: null });
    expect(cleared.status).toBe(200);
    expect(
      cleared.body.data.items.find((item: { id: string }) => item.id === line.id)
        .staffId
    ).toBeNull();

    const empty = await request(app)
      .patch(`/api/job-carts/${id}/items/${line.id}`)
      .set(auth(f.adminToken))
      .send({});
    expect(empty.status).toBe(400);
  });

  it("lists carts confirmed with a draft invoice under the completed filter", async () => {
    const f = await fixture();
    const created = await createCart(f, f.adminToken, {
      staffId: f.stylist.id,
    });
    const id = created.body.data.id as string;
    const confirmed = await request(app)
      .post(`/api/job-carts/${id}/confirm`)
      .set(auth(f.adminToken))
      .send({ status: "DRAFT" });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data).toMatchObject({
      status: "COMPLETED",
      invoice: { status: "DRAFT" },
    });
    const listed = await request(app)
      .get("/api/job-carts?status=COMPLETED")
      .set(auth(f.adminToken));
    expect(listed.status).toBe(200);
    expect(
      listed.body.data.map((cart: { id: string }) => cart.id)
    ).toContain(id);
    const active = await request(app)
      .get("/api/job-carts?status=ACTIVE")
      .set(auth(f.adminToken));
    expect(
      active.body.data.map((cart: { id: string }) => cart.id)
    ).not.toContain(id);
  });

  it("confirms transactionally through appointment completion and invoice issue", async () => {
    const f = await fixture();
    const created = await createCart(f, f.adminToken, {
      staffId: f.stylist.id,
    });
    const id = created.body.data.id as string;
    await request(app)
      .patch(`/api/invoices/${created.body.data.invoice.id}/issue`)
      .set(auth(f.adminToken))
      .expect(409);
    const confirmed = await request(app)
      .post(`/api/job-carts/${id}/confirm`)
      .set(auth(f.adminToken));

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data).toMatchObject({
      status: "COMPLETED",
      appointmentStatus: "COMPLETED",
      invoice: { status: "ISSUED" },
    });
    expect(
      Number(
        (
          await prisma.product.findUniqueOrThrow({
            where: { id: f.product.id },
          })
        ).currentStock
      )
    ).toBe(8);
    expect(
      await prisma.customerTransaction.count({
        where: {
          invoiceId: confirmed.body.data.invoice.id,
          type: "INVOICE",
        },
      })
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { entityId: id, module: "JOB_CART", action: "COMPLETE" },
      })
    ).toBe(1);
  });

  it("issues the invoice and marks it paid when payment is collected on confirm", async () => {
    const f = await fixture();
    const created = await createCart(f, f.adminToken, {
      staffId: f.stylist.id,
    });
    const id = created.body.data.id as string;

    const confirmed = await request(app)
      .post(`/api/job-carts/${id}/confirm`)
      .set(auth(f.adminToken))
      .send({ payment: { method: "GPAY", referenceNo: "TXN-1" } });

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data).toMatchObject({
      status: "COMPLETED",
      appointmentStatus: "COMPLETED",
      invoice: { status: "ISSUED", paymentStatus: "PAID" },
    });
    expect(Number(confirmed.body.data.invoice.paidAmount)).toBe(500);
    expect(Number(confirmed.body.data.invoice.balanceAmount)).toBe(0);

    const payments = await prisma.payment.findMany({
      where: { invoiceId: confirmed.body.data.invoice.id },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      method: "GPAY",
      referenceNo: "TXN-1",
    });
    expect(Number(payments[0]!.amount)).toBe(500);

    // The bill was raised and settled, so the customer owes nothing.
    expect(
      Number(
        (
          await prisma.customer.findUniqueOrThrow({
            where: { id: confirmed.body.data.customerId },
          })
        ).outstandingAmount
      )
    ).toBe(0);
    expect(
      await prisma.customerTransaction.count({
        where: {
          invoiceId: confirmed.body.data.invoice.id,
          type: "PAYMENT",
        },
      })
    ).toBe(1);
  });

  it("leaves a part payment outstanding and rejects an overpayment on confirm", async () => {
    const f = await fixture();
    const partial = await createCart(f, f.adminToken, {
      staffId: f.stylist.id,
    });
    const partiallyPaid = await request(app)
      .post(`/api/job-carts/${partial.body.data.id}/confirm`)
      .set(auth(f.adminToken))
      .send({ payment: { method: "CASH", amount: 200 } });

    expect(partiallyPaid.status).toBe(200);
    expect(partiallyPaid.body.data.invoice).toMatchObject({
      status: "ISSUED",
      paymentStatus: "PARTIALLY_PAID",
    });
    expect(Number(partiallyPaid.body.data.invoice.balanceAmount)).toBe(300);
    expect(
      Number(
        (
          await prisma.customer.findUniqueOrThrow({
            where: { id: partiallyPaid.body.data.customerId },
          })
        ).outstandingAmount
      )
    ).toBe(300);

    const overpaid = await createCart(f, f.adminToken, {
      staffId: f.stylist.id,
      startTime: "2038-01-02T10:00:00.000Z",
    });
    const rejected = await request(app)
      .post(`/api/job-carts/${overpaid.body.data.id}/confirm`)
      .set(auth(f.adminToken))
      .send({ payment: { method: "CASH", amount: 900 } });

    expect(rejected.status).toBe(400);
    // The whole confirm rolls back, so the cart is still billable.
    expect(
      await prisma.appointment.findUniqueOrThrow({
        where: { id: overpaid.body.data.id },
        select: { status: true },
      })
    ).toEqual({ status: "SCHEDULED" });
    expect(
      await prisma.payment.count({
        where: { invoiceId: overpaid.body.data.invoice.id },
      })
    ).toBe(0);
  });

  it("rejects a payment on confirm when the invoice is left as a draft", async () => {
    const f = await fixture();
    const created = await createCart(f, f.adminToken, {
      staffId: f.stylist.id,
    });
    const rejected = await request(app)
      .post(`/api/job-carts/${created.body.data.id}/confirm`)
      .set(auth(f.adminToken))
      .send({ status: "DRAFT", payment: { method: "CASH" } });

    expect(rejected.status).toBe(400);
    expect(
      await prisma.payment.count({
        where: { invoiceId: created.body.data.invoice.id },
      })
    ).toBe(0);
  });

  it("settles a confirm from the membership wallet and refuses one it cannot cover", async () => {
    const f = await fixture();
    const membership = await prisma.membership.create({
      data: {
        name: `Wallet Plan ${randomUUID()}`,
        salonId: f.salon.id,
        price: 1000,
        discountPercentage: 0,
        durationMonths: 12,
      },
    });
    const cart = await createCart(f, f.adminToken, { staffId: f.stylist.id });
    await prisma.customerMembership.create({
      data: {
        salonId: f.salon.id,
        branchId: f.branch.id,
        customerId: cart.body.data.customerId,
        membershipId: membership.id,
        membershipNameSnapshot: membership.name,
        discountPercentageSnapshot: 0,
        durationMonthsSnapshot: 12,
        startsAt: new Date("2020-01-01T00:00:00.000Z"),
        expiresAt: new Date("2040-01-01T00:00:00.000Z"),
        status: "ACTIVE",
        walletCredited: 400,
        walletBalance: 400,
      },
    });

    const short = await request(app)
      .post(`/api/job-carts/${cart.body.data.id}/confirm`)
      .set(auth(f.adminToken))
      .send({ payment: { method: "MEMBERSHIP_WALLET" } });
    expect(short.status).toBe(400);

    const paid = await request(app)
      .post(`/api/job-carts/${cart.body.data.id}/confirm`)
      .set(auth(f.adminToken))
      .send({ payment: { method: "MEMBERSHIP_WALLET", amount: 400 } });

    expect(paid.status).toBe(200);
    expect(paid.body.data.invoice).toMatchObject({
      status: "ISSUED",
      paymentStatus: "PARTIALLY_PAID",
    });
    expect(Number(paid.body.data.invoice.paidAmount)).toBe(400);
    expect(
      Number(
        (
          await prisma.customerMembership.findFirstOrThrow({
            where: { customerId: cart.body.data.customerId },
          })
        ).walletBalance
      )
    ).toBe(0);
  });

  it("cancels an active cart and blocks edits to cancelled or completed carts", async () => {
    const f = await fixture();
    const cancellable = await createCart(f);
    const cancelled = await request(app)
      .post(`/api/job-carts/${cancellable.body.data.id}/cancel`)
      .set(auth(f.adminToken));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({
      status: "CANCELLED",
      appointmentStatus: "CANCELLED",
      invoice: { status: "CANCELLED" },
    });
    await request(app)
      .put(`/api/job-carts/${cancellable.body.data.id}`)
      .set(auth(f.adminToken))
      .send({ bookingNote: "Too late" })
      .expect(409);

    const complete = await createCart(f, f.adminToken, {
      phone: "9876543211",
      startTime: "2038-01-02T10:00:00.000Z",
    });
    await request(app)
      .post(`/api/job-carts/${complete.body.data.id}/confirm`)
      .set(auth(f.adminToken))
      .expect(200);
    await request(app)
      .post(`/api/job-carts/${complete.body.data.id}/items`)
      .set(auth(f.adminToken))
      .send({ serviceId: f.secondService.id })
      .expect(409);
  });

  it("enforces tenant, branch, and staff access restrictions", async () => {
    const f = await fixture();
    const created = await createCart(f, f.receptionistToken);
    const id = created.body.data.id as string;

    await request(app)
      .get(`/api/job-carts/${id}`)
      .set(auth(f.otherAdminToken))
      .expect(404);
    await request(app)
      .get(`/api/job-carts/${id}`)
      .set(auth(f.otherReceptionistToken))
      .expect(404);
    await request(app)
      .get("/api/job-carts")
      .set(auth(f.staffToken))
      .expect(403);
    await createCart(f, f.receptionistToken, {
      branchId: f.otherBranch.id,
      phone: "9876543222",
    }).expect(404);
  });

  it("lists every job cart linked to a selected customer", async () => {
    const f = await fixture();
    const first = await createCart(f, f.adminToken, {
      phone: "98765 49901",
      startTime: "2038-01-03T10:00:00.000Z",
    });
    const second = await createCart(f, f.adminToken, {
      phone: "9876549901",
      startTime: "2038-01-04T10:00:00.000Z",
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.customerId).toBe(first.body.data.customerId);

    const history = await request(app)
      .get("/api/job-carts")
      .query({
        customerId: first.body.data.customerId,
        page: 1,
        limit: 20,
      })
      .set(auth(f.adminToken));

    expect(history.status).toBe(200);
    expect(history.body.pagination.total).toBe(2);
    expect(
      history.body.data.every(
        (cart: { customerId: string }) =>
          cart.customerId === first.body.data.customerId
      )
    ).toBe(true);
  });

  it("applies membership and coupon logic to the draft before issuing", async () => {
    const f = await fixture();
    const membership = await prisma.membership.create({
      data: {
        salonId: f.salon.id,
        name: `Job Gold ${randomUUID()}`,
        discountPercentage: 10,
      },
    });
    await prisma.customer.create({
      data: {
        customerCode: `JCM-${randomUUID()}`,
        name: "Member Walk-in",
        phone: "9876543233",
        salonId: f.salon.id,
        branchId: f.branch.id,
        membershipId: membership.id,
      },
    });
    const coupon = await prisma.coupon.create({
      data: {
        salonId: f.salon.id,
        branchId: f.branch.id,
        couponCode: `JC${randomUUID().slice(0, 8)}`.toUpperCase(),
        discountPercentage: 10,
        validFrom: new Date("2020-01-01T00:00:00.000Z"),
        validUntil: new Date("2040-01-01T00:00:00.000Z"),
      },
    });
    const created = await createCart(f, f.adminToken, {
      customerName: "Member Walk-in",
      phone: "9876543233",
    });
    expect(Number(created.body.data.invoice.discountAmount)).toBe(50);
    const applied = await request(app)
      .post(`/api/invoices/${created.body.data.invoice.id}/apply-coupon`)
      .set(auth(f.adminToken))
      .send({ couponCode: coupon.couponCode });
    expect(applied.status).toBe(200);
    expect(Number(applied.body.data.totalAmount)).toBe(405);

    await request(app)
      .post(`/api/job-carts/${created.body.data.id}/confirm`)
      .set(auth(f.adminToken))
      .expect(200);
    expect(
      (
        await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })
      ).usedCount
    ).toBe(1);
  });

  it("rolls back confirmation when the transactional job-cart audit fails", async () => {
    const f = await fixture();
    const created = await createCart(f);
    const id = created.body.data.id as string;
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_job_cart_audit()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."module" = 'JOB_CART' AND NEW."action" = 'COMPLETE' THEN
          RAISE EXCEPTION 'forced job cart audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS fail_job_cart_audit_trigger ON "AuditLog"`
    );
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_job_cart_audit_trigger
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION fail_job_cart_audit()
    `);

    try {
      await request(app)
        .post(`/api/job-carts/${id}/confirm`)
        .set(auth(f.adminToken))
        .expect(500);
      const unchanged = await prisma.appointment.findUniqueOrThrow({
        where: { id },
        include: { invoice: true },
      });
      expect(unchanged.status).toBe("SCHEDULED");
      expect(unchanged.invoice?.status).toBe("DRAFT");
      expect(
        await prisma.customerTransaction.count({
          where: { invoiceId: unchanged.invoice!.id },
        })
      ).toBe(0);
      expect(
        Number(
          (
            await prisma.product.findUniqueOrThrow({
              where: { id: f.product.id },
            })
          ).currentStock
        )
      ).toBe(10);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS fail_job_cart_audit_trigger ON "AuditLog"`
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS fail_job_cart_audit()`
      );
    }
  });
});
