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
    data: { name: `Package Salon ${marker}` },
  });
  const otherSalon = await prisma.salon.create({
    data: { name: `Other Package Salon ${marker}` },
  });
  const branch = await prisma.branch.create({
    data: { salonId: salon.id, name: `Package Main ${marker}` },
  });
  const otherBranch = await prisma.branch.create({
    data: { salonId: salon.id, name: `Package Other ${marker}` },
  });
  const admin = await prisma.user.create({
    data: {
      name: "Package Admin",
      email: `package-admin-${marker}@test.com`,
      passwordHash: "test",
      role: "SALON_ADMIN",
      salonId: salon.id,
    },
  });
  const foreignAdmin = await prisma.user.create({
    data: {
      name: "Foreign Package Admin",
      email: `foreign-package-admin-${marker}@test.com`,
      passwordHash: "test",
      role: "SALON_ADMIN",
      salonId: otherSalon.id,
    },
  });
  const receptionist = await prisma.user.create({
    data: {
      name: "Package Receptionist",
      email: `package-reception-${marker}@test.com`,
      passwordHash: "test",
      role: "RECEPTIONIST",
      salonId: salon.id,
      branchId: branch.id,
    },
  });
  const staffUser = await prisma.user.create({
    data: {
      name: "Package Staff User",
      email: `package-staff-${marker}@test.com`,
      passwordHash: "test",
      role: "STAFF",
      salonId: salon.id,
      branchId: branch.id,
    },
  });
  const stylist = await prisma.staff.create({
    data: {
      name: "Package Seller",
      email: `package-seller-${marker}@test.com`,
      jobRole: "Stylist",
      workingFrom: "09:00",
      workingTo: "18:00",
      weekOff: "Sunday",
      salonId: salon.id,
      branchId: branch.id,
    },
  });
  const mainService = await prisma.mainService.create({
    data: { salonId: salon.id, name: `Package Services ${marker}` },
  });
  const service = await prisma.service.create({
    data: {
      salonId: salon.id,
      branchId: branch.id,
      mainServiceId: mainService.id,
      name: `Package Facial ${marker}`,
      price: 600,
      durationValue: 45,
    },
  });
  const service2 = await prisma.service.create({
    data: {
      salonId: salon.id,
      branchId: branch.id,
      mainServiceId: mainService.id,
      name: `Package Cleanup ${marker}`,
      price: 400,
      durationValue: 30,
    },
  });
  return {
    salon,
    otherSalon,
    branch,
    otherBranch,
    adminToken: tokenFor(admin),
    foreignAdminToken: tokenFor(foreignAdmin),
    receptionistToken: tokenFor(receptionist),
    staffToken: tokenFor(staffUser),
    stylist,
    service,
    service2,
  };
};

const createCategory = async (
  fixtureData: Awaited<ReturnType<typeof fixture>>,
  name = `Skin ${randomUUID()}`
) =>
  request(app)
    .post("/api/package-categories")
    .set(auth(fixtureData.adminToken))
    .send({ name, branchId: fixtureData.branch.id });

const createPackage = async (
  fixtureData: Awaited<ReturnType<typeof fixture>>,
  categoryId: string,
  overrides: Record<string, unknown> = {}
) =>
  request(app)
    .post("/api/packages")
    .set(auth(fixtureData.adminToken))
    .send({
      categoryId,
      branchId: fixtureData.branch.id,
      name: `Glow Bundle ${randomUUID()}`,
      serviceIds: [fixtureData.service.id, fixtureData.service2.id],
      specialPrice: 800,
      validityDays: 30,
      ...overrides,
    });

const sellPackage = async (
  f: Awaited<ReturnType<typeof fixture>>,
  overrides: Record<string, unknown> = {}
) => {
  const category = await createCategory(f);
  const servicePackage = await createPackage(f, category.body.data.id, {
    validityDays: 90,
    ...overrides,
  });
  const phone = `98${Math.floor(10000000 + Math.random() * 89999999)}`;
  const cart = await request(app)
    .post("/api/job-carts")
    .set(auth(f.adminToken))
    .send({
      branchId: f.branch.id,
      customerName: "Redemption Customer",
      phone,
      startTime: "2039-05-01T10:00:00.000Z",
      serviceIds: [],
    });
  await request(app)
    .post(`/api/job-carts/${cart.body.data.id}/items`)
    .set(auth(f.adminToken))
    .send({
      itemType: "PACKAGE",
      packageId: servicePackage.body.data.id,
      staffId: f.stylist.id,
    })
    .expect(200);
  const confirmed = await request(app)
    .post(`/api/job-carts/${cart.body.data.id}/confirm`)
    .set(auth(f.adminToken));
  expect(confirmed.status).toBe(200);
  const customerPackage = await prisma.customerPackage.findFirstOrThrow({
    where: { invoiceId: confirmed.body.data.invoice.id },
    include: { serviceBalances: true },
  });
  return {
    category,
    servicePackage: servicePackage.body.data,
    customerPackage,
    customerId: cart.body.data.customerId as string,
    phone,
    saleInvoiceId: confirmed.body.data.invoice.id as string,
  };
};

const createRedemptionCart = async (
  f: Awaited<ReturnType<typeof fixture>>,
  sale: Awaited<ReturnType<typeof sellPackage>>,
  suffix = "01",
  branchId = f.branch.id
) =>
  request(app)
    .post("/api/job-carts")
    .set(auth(f.adminToken))
    .send({
      branchId,
      customerName: "Redemption Customer",
      phone: sale.phone,
      startTime: `2039-06-${suffix}T10:00:00.000Z`,
      serviceIds: [],
    });

describe("Service packages", () => {
  it("creates, updates, filters, and changes package category status with tenant isolation", async () => {
    const f = await fixture();
    const name = `Skin ${randomUUID()}`;
    const created = await createCategory(f, name);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      name,
      status: "ACTIVE",
      salonId: f.salon.id,
    });

    expect((await createCategory(f, name)).status).toBe(409);
    const foreign = await request(app)
      .post("/api/package-categories")
      .set(auth(f.foreignAdminToken))
      .send({ name });
    expect(foreign.status).toBe(201);

    const updated = await request(app)
      .put(`/api/package-categories/${created.body.data.id}`)
      .set(auth(f.adminToken))
      .send({ name: `${name} Updated`, branchId: f.branch.id });
    expect(updated.status).toBe(200);

    await request(app)
      .patch(`/api/package-categories/${created.body.data.id}/status`)
      .set(auth(f.adminToken))
      .send({ status: "INACTIVE" })
      .expect(200);
    await request(app)
      .get(`/api/package-categories/${created.body.data.id}`)
      .set(auth(f.foreignAdminToken))
      .expect(404);

    const filtered = await request(app)
      .get("/api/package-categories")
      .query({ status: "INACTIVE", search: "Updated", page: 1, limit: 5 })
      .set(auth(f.adminToken));
    expect(filtered.status).toBe(200);
    expect(filtered.body.pagination.total).toBe(1);
  });

  it("calculates package total from service snapshots and validates services and pricing", async () => {
    const f = await fixture();
    const category = await createCategory(f);
    const created = await createPackage(f, category.body.data.id);
    expect(created.status).toBe(201);
    expect(Number(created.body.data.totalPrice)).toBe(1000);
    expect(Number(created.body.data.specialPrice)).toBe(800);
    expect(created.body.data.items).toHaveLength(2);

    expect((await createPackage(f, category.body.data.id, {
      name: `Empty ${randomUUID()}`,
      serviceIds: [],
    })).status).toBe(400);
    expect((await createPackage(f, category.body.data.id, {
      name: `Overpriced ${randomUUID()}`,
      specialPrice: 1001,
    })).status).toBe(400);

    const updated = await request(app)
      .put(`/api/packages/${created.body.data.id}`)
      .set(auth(f.adminToken))
      .send({
        categoryId: category.body.data.id,
        branchId: f.branch.id,
        name: created.body.data.name,
        serviceIds: [f.service.id],
        specialPrice: 500,
        validityDays: 45,
      });
    expect(updated.status).toBe(200);
    expect(Number(updated.body.data.totalPrice)).toBe(600);
    expect(updated.body.data.items).toHaveLength(1);
  });

  it("enforces package RBAC and only exposes active packages to receptionists", async () => {
    const f = await fixture();
    const category = await createCategory(f);
    const servicePackage = await createPackage(f, category.body.data.id);
    await request(app)
      .post("/api/packages")
      .set(auth(f.staffToken))
      .send({})
      .expect(403);
    await request(app)
      .patch(`/api/packages/${servicePackage.body.data.id}/status`)
      .set(auth(f.adminToken))
      .send({ status: "INACTIVE" })
      .expect(200);
    const receptionistList = await request(app)
      .get("/api/packages")
      .set(auth(f.receptionistToken));
    expect(receptionistList.status).toBe(200);
    expect(receptionistList.body.data).toHaveLength(0);
  });

  it("adds and removes a package while preserving draft invoice calculations", async () => {
    const f = await fixture();
    const category = await createCategory(f);
    const servicePackage = await createPackage(f, category.body.data.id);
    const cart = await request(app)
      .post("/api/job-carts")
      .set(auth(f.adminToken))
      .send({
        branchId: f.branch.id,
        customerName: "Package Buyer",
        phone: "9876501001",
        startTime: "2039-01-01T10:00:00.000Z",
        serviceIds: [],
      });
    expect(cart.status).toBe(201);
    const added = await request(app)
      .post(`/api/job-carts/${cart.body.data.id}/items`)
      .set(auth(f.adminToken))
      .send({
        itemType: "PACKAGE",
        packageId: servicePackage.body.data.id,
        staffId: f.stylist.id,
      });
    expect(added.status).toBe(200);
    const item = added.body.data.items.find(
      (value: { itemType: string }) => value.itemType === "PACKAGE"
    );
    expect(item.soldByStaffId).toBe(f.stylist.id);
    expect(Number(added.body.data.invoice.totalAmount)).toBe(800);

    const removed = await request(app)
      .delete(`/api/job-carts/${cart.body.data.id}/items/${item.id}`)
      .set(auth(f.adminToken));
    expect(removed.status).toBe(200);
    expect(Number(removed.body.data.invoice.totalAmount)).toBe(0);
  });

  it("confirms a prepaid package sale, exposes it in summary, and cancels it with the invoice", async () => {
    const f = await fixture();
    const category = await createCategory(f);
    const servicePackage = await createPackage(f, category.body.data.id, {
      validityDays: 60,
    });
    const cart = await request(app)
      .post("/api/job-carts")
      .set(auth(f.receptionistToken))
      .send({
        branchId: f.branch.id,
        customerName: "Summary Package Buyer",
        phone: "9876501002",
        startTime: "2039-02-01T10:00:00.000Z",
        serviceIds: [],
      });
    await request(app)
      .post(`/api/job-carts/${cart.body.data.id}/items`)
      .set(auth(f.receptionistToken))
      .send({
        itemType: "PACKAGE",
        packageId: servicePackage.body.data.id,
        staffId: f.stylist.id,
      })
      .expect(200);
    const confirmed = await request(app)
      .post(`/api/job-carts/${cart.body.data.id}/confirm`)
      .set(auth(f.receptionistToken));
    expect(confirmed.status).toBe(200);

    const purchased = await prisma.customerPackage.findFirstOrThrow({
      where: { invoiceId: confirmed.body.data.invoice.id },
    });
    expect(purchased.status).toBe("ACTIVE");
    expect(purchased.soldByStaffId).toBe(f.stylist.id);
    expect(
      Math.round(
        (purchased.validUntil.getTime() - purchased.purchasedAt.getTime()) /
          86_400_000
      )
    ).toBe(60);

    const summary = await request(app)
      .get("/api/job-carts/customer-summary")
      .query({ customerId: cart.body.data.customerId })
      .set(auth(f.receptionistToken));
    expect(summary.status).toBe(200);
    expect(summary.body.data.activePackages[0]).toMatchObject({
      customerPackageId: purchased.id,
      packageName: purchased.packageNameSnapshot,
      soldByStaffName: f.stylist.name,
    });

    await request(app)
      .patch(`/api/invoices/${confirmed.body.data.invoice.id}/cancel`)
      .set(auth(f.adminToken))
      .expect(200);
    expect(
      (
        await prisma.customerPackage.findUniqueOrThrow({
          where: { id: purchased.id },
        })
      ).status
    ).toBe("CANCELLED");
  });

  it("rejects inactive, foreign-tenant, and wrong-branch package sales", async () => {
    const f = await fixture();
    const category = await createCategory(f);
    const servicePackage = await createPackage(f, category.body.data.id);
    const cart = await request(app)
      .post("/api/job-carts")
      .set(auth(f.adminToken))
      .send({
        branchId: f.otherBranch.id,
        customerName: "Wrong Branch Buyer",
        phone: "9876501003",
        startTime: "2039-03-01T10:00:00.000Z",
        serviceIds: [],
      });
    await request(app)
      .post(`/api/job-carts/${cart.body.data.id}/items`)
      .set(auth(f.adminToken))
      .send({
        itemType: "PACKAGE",
        packageId: servicePackage.body.data.id,
      })
      .expect(400);

    await request(app)
      .patch(`/api/packages/${servicePackage.body.data.id}/status`)
      .set(auth(f.adminToken))
      .send({ status: "INACTIVE" })
      .expect(200);
    const branchCart = await request(app)
      .post("/api/job-carts")
      .set(auth(f.adminToken))
      .send({
        branchId: f.branch.id,
        customerName: "Inactive Buyer",
        phone: "9876501004",
        startTime: "2039-03-02T10:00:00.000Z",
        serviceIds: [],
      });
    await request(app)
      .post(`/api/job-carts/${branchCart.body.data.id}/items`)
      .set(auth(f.adminToken))
      .send({
        itemType: "PACKAGE",
        packageId: servicePackage.body.data.id,
      })
      .expect(400);
  });

  it("rolls back package creation when its transactional audit fails", async () => {
    const f = await fixture();
    const category = await createCategory(f);
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_package_create_audit()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."module" = 'PACKAGE' AND NEW."action" = 'CREATE'
           AND NEW."description" LIKE 'Package % created' THEN
          RAISE EXCEPTION 'forced package create audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS fail_package_create_audit_trigger ON "AuditLog"`
    );
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_package_create_audit_trigger
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION fail_package_create_audit()
    `);
    const name = `Rollback Package ${randomUUID()}`;
    try {
      const response = await createPackage(f, category.body.data.id, { name });
      expect(response.status).toBe(500);
      expect(
        await prisma.servicePackage.count({
          where: { salonId: f.salon.id, name },
        })
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS fail_package_create_audit_trigger ON "AuditLog"`
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS fail_package_create_audit()`
      );
    }
  });

  it("rolls back package entitlement and invoice issue when confirmation audit fails", async () => {
    const f = await fixture();
    const category = await createCategory(f);
    const servicePackage = await createPackage(f, category.body.data.id);
    const cart = await request(app)
      .post("/api/job-carts")
      .set(auth(f.adminToken))
      .send({
        branchId: f.branch.id,
        customerName: "Rollback Buyer",
        phone: "9876501099",
        startTime: "2039-04-01T10:00:00.000Z",
        serviceIds: [],
      });
    await request(app)
      .post(`/api/job-carts/${cart.body.data.id}/items`)
      .set(auth(f.adminToken))
      .send({
        itemType: "PACKAGE",
        packageId: servicePackage.body.data.id,
      })
      .expect(200);
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_customer_package_audit()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."module" = 'PACKAGE' AND NEW."action" = 'CREATE'
           AND NEW."description" LIKE 'Customer package %' THEN
          RAISE EXCEPTION 'forced customer package audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS fail_customer_package_audit_trigger ON "AuditLog"`
    );
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_customer_package_audit_trigger
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION fail_customer_package_audit()
    `);
    try {
      await request(app)
        .post(`/api/job-carts/${cart.body.data.id}/confirm`)
        .set(auth(f.adminToken))
        .expect(500);
      const unchanged = await prisma.appointment.findUniqueOrThrow({
        where: { id: cart.body.data.id },
        include: { invoice: true },
      });
      expect(unchanged.status).toBe("SCHEDULED");
      expect(unchanged.invoice?.status).toBe("DRAFT");
      expect(
        await prisma.customerPackage.count({
          where: { jobCartAppointmentId: cart.body.data.id },
        })
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS fail_customer_package_audit_trigger ON "AuditLog"`
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS fail_customer_package_audit()`
      );
    }
  });

  it("creates service balances on sale and returns them through package balance APIs", async () => {
    const f = await fixture();
    const sale = await sellPackage(f);
    expect(sale.customerPackage.serviceBalances).toHaveLength(2);
    expect(
      sale.customerPackage.serviceBalances.every(
        (balance) =>
          balance.includedQuantity === 1 &&
          balance.usedQuantity === 0 &&
          balance.reservedQuantity === 0
      )
    ).toBe(true);

    const byPackage = await request(app)
      .get(
        `/api/customer-packages/${sale.customerPackage.id}/balances`
      )
      .set(auth(f.adminToken));
    expect(byPackage.status).toBe(200);
    expect(byPackage.body.data.balances[0].remainingQuantity).toBe(1);

    const byCustomer = await request(app)
      .get(`/api/customers/${sale.customerId}/package-balances`)
      .set(auth(f.receptionistToken));
    expect(byCustomer.status).toBe(200);
    expect(byCustomer.body.data[0].customerPackageId).toBe(
      sale.customerPackage.id
    );
  });

  it("reserves and removes package redemption without changing payable revenue", async () => {
    const f = await fixture();
    const sale = await sellPackage(f);
    const cart = await createRedemptionCart(f, sale);
    const balance = sale.customerPackage.serviceBalances[0]!;
    const reserved = await request(app)
      .post(`/api/job-carts/${cart.body.data.id}/package-redemptions`)
      .set(auth(f.receptionistToken))
      .send({
        customerPackageId: sale.customerPackage.id,
        items: [
          {
            serviceId: balance.serviceId,
            quantity: 1,
            staffId: f.stylist.id,
          },
        ],
      });
    expect(reserved.status).toBe(201);
    expect(Number(reserved.body.data.invoice.totalAmount)).toBe(0);
    expect(reserved.body.data.packageRedemptions[0].status).toBe("RESERVED");
    expect(
      (
        await prisma.customerPackageServiceBalance.findUniqueOrThrow({
          where: { id: balance.id },
        })
      ).reservedQuantity
    ).toBe(1);

    const usageId = reserved.body.data.packageRedemptions[0].id as string;
    const removed = await request(app)
      .delete(
        `/api/job-carts/${cart.body.data.id}/package-redemptions/${usageId}`
      )
      .set(auth(f.receptionistToken));
    expect(removed.status).toBe(200);
    expect(
      (
        await prisma.customerPackageServiceBalance.findUniqueOrThrow({
          where: { id: balance.id },
        })
      ).reservedQuantity
    ).toBe(0);
    expect(
      (
        await prisma.customerPackageUsage.findUniqueOrThrow({
          where: { id: usageId },
        })
      ).status
    ).toBe("CANCELLED");
  });

  it("uses redemption on confirmation, deducts consumables, and does not post duplicate revenue", async () => {
    const f = await fixture();
    const product = await prisma.product.create({
      data: {
        salonId: f.salon.id,
        branchId: f.branch.id,
        name: `Redemption Consumable ${randomUUID()}`,
        currentStock: 10,
        isServiceConsumable: true,
      },
    });
    await prisma.serviceConsumable.create({
      data: {
        salonId: f.salon.id,
        serviceId: f.service.id,
        productId: product.id,
        quantity: 2,
      },
    });
    const sale = await sellPackage(f);
    const balance = sale.customerPackage.serviceBalances.find(
      (item) => item.serviceId === f.service.id
    )!;
    const cart = await createRedemptionCart(f, sale, "02");
    await request(app)
      .post(`/api/job-carts/${cart.body.data.id}/package-redemptions`)
      .set(auth(f.adminToken))
      .send({
        customerPackageId: sale.customerPackage.id,
        items: [{ serviceId: f.service.id, quantity: 1 }],
      })
      .expect(201);
    const confirmed = await request(app)
      .post(`/api/job-carts/${cart.body.data.id}/confirm`)
      .set(auth(f.adminToken));
    expect(confirmed.status).toBe(200);
    expect(Number(confirmed.body.data.invoice.totalAmount)).toBe(0);
    expect(
      await prisma.customerTransaction.count({
        where: {
          invoiceId: confirmed.body.data.invoice.id,
          type: "INVOICE",
        },
      })
    ).toBe(0);
    expect(
      Number(
        (
          await prisma.product.findUniqueOrThrow({
            where: { id: product.id },
          })
        ).currentStock
      )
    ).toBe(8);
    const updatedBalance =
      await prisma.customerPackageServiceBalance.findUniqueOrThrow({
        where: { id: balance.id },
      });
    expect(updatedBalance.reservedQuantity).toBe(0);
    expect(updatedBalance.usedQuantity).toBe(1);
    expect(
      (
        await prisma.customerPackageUsage.findFirstOrThrow({
          where: { invoiceId: confirmed.body.data.invoice.id },
        })
      ).status
    ).toBe("USED");
  });

  it("rejects exhausted, expired, cancelled, wrong-customer, and wrong-branch redemption", async () => {
    const f = await fixture();
    const sale = await sellPackage(f);
    const balance = sale.customerPackage.serviceBalances[0]!;
    const cart = await createRedemptionCart(f, sale, "03");
    const redeem = (customerPackageId: string, quantity = 1) =>
      request(app)
        .post(`/api/job-carts/${cart.body.data.id}/package-redemptions`)
        .set(auth(f.adminToken))
        .send({
          customerPackageId,
          items: [{ serviceId: balance.serviceId, quantity }],
        });
    expect((await redeem(sale.customerPackage.id, 2)).status).toBe(409);

    await prisma.customerPackage.update({
      where: { id: sale.customerPackage.id },
      data: {
        status: "ACTIVE",
        validUntil: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    expect((await redeem(sale.customerPackage.id)).status).toBe(409);
    await prisma.customerPackage.update({
      where: { id: sale.customerPackage.id },
      data: { status: "CANCELLED", validUntil: new Date("2040-01-01") },
    });
    expect((await redeem(sale.customerPackage.id)).status).toBe(409);

    await prisma.customerPackage.update({
      where: { id: sale.customerPackage.id },
      data: { status: "ACTIVE" },
    });
    const otherCart = await request(app)
      .post("/api/job-carts")
      .set(auth(f.adminToken))
      .send({
        branchId: f.branch.id,
        customerName: "Different Customer",
        phone: "9876501998",
        startTime: "2039-06-04T10:00:00.000Z",
        serviceIds: [],
      });
    await request(app)
      .post(`/api/job-carts/${otherCart.body.data.id}/package-redemptions`)
      .set(auth(f.adminToken))
      .send({
        customerPackageId: sale.customerPackage.id,
        items: [{ serviceId: balance.serviceId, quantity: 1 }],
      })
      .expect(404);

    const wrongBranchCart = await createRedemptionCart(
      f,
      sale,
      "05",
      f.otherBranch.id
    );
    await request(app)
      .post(
        `/api/job-carts/${wrongBranchCart.body.data.id}/package-redemptions`
      )
      .set(auth(f.adminToken))
      .send({
        customerPackageId: sale.customerPackage.id,
        items: [{ serviceId: balance.serviceId, quantity: 1 }],
      })
      .expect(400);

    await request(app)
      .post(`/api/job-carts/${cart.body.data.id}/package-redemptions`)
      .set(auth(f.foreignAdminToken))
      .send({
        customerPackageId: sale.customerPackage.id,
        items: [{ serviceId: balance.serviceId, quantity: 1 }],
      })
      .expect(404);
    const otherReceptionist = await prisma.user.create({
      data: {
        name: "Other Branch Package Receptionist",
        email: `other-redemption-${randomUUID()}@test.com`,
        passwordHash: "test",
        role: "RECEPTIONIST",
        salonId: f.salon.id,
        branchId: f.otherBranch.id,
      },
    });
    await request(app)
      .post(`/api/job-carts/${cart.body.data.id}/package-redemptions`)
      .set(auth(tokenFor(otherReceptionist)))
      .send({
        customerPackageId: sale.customerPackage.id,
        items: [{ serviceId: balance.serviceId, quantity: 1 }],
      })
      .expect(404);
    await request(app)
      .post(`/api/job-carts/${cart.body.data.id}/package-redemptions`)
      .set(auth(f.staffToken))
      .send({
        customerPackageId: sale.customerPackage.id,
        items: [{ serviceId: balance.serviceId, quantity: 1 }],
      })
      .expect(403);
  });

  it("reverses reserved usage on cart cancellation and used usage on invoice cancellation", async () => {
    const f = await fixture();
    const firstSale = await sellPackage(f);
    const firstBalance = firstSale.customerPackage.serviceBalances[0]!;
    const activeCart = await createRedemptionCart(f, firstSale, "06");
    await request(app)
      .post(`/api/job-carts/${activeCart.body.data.id}/package-redemptions`)
      .set(auth(f.adminToken))
      .send({
        customerPackageId: firstSale.customerPackage.id,
        items: [{ serviceId: firstBalance.serviceId, quantity: 1 }],
      })
      .expect(201);
    await request(app)
      .post(`/api/job-carts/${activeCart.body.data.id}/cancel`)
      .set(auth(f.adminToken))
      .expect(200);
    expect(
      (
        await prisma.customerPackageServiceBalance.findUniqueOrThrow({
          where: { id: firstBalance.id },
        })
      ).reservedQuantity
    ).toBe(0);

    const secondSale = await sellPackage(f);
    const secondBalance = secondSale.customerPackage.serviceBalances.find(
      (item) => item.serviceId === f.service.id
    )!;
    const product = await prisma.product.create({
      data: {
        salonId: f.salon.id,
        branchId: f.branch.id,
        name: `Cancellation Consumable ${randomUUID()}`,
        currentStock: 10,
        isServiceConsumable: true,
      },
    });
    await prisma.serviceConsumable.create({
      data: {
        salonId: f.salon.id,
        serviceId: f.service.id,
        productId: product.id,
        quantity: 2,
      },
    });
    const usedCart = await createRedemptionCart(f, secondSale, "07");
    await request(app)
      .post(`/api/job-carts/${usedCart.body.data.id}/package-redemptions`)
      .set(auth(f.adminToken))
      .send({
        customerPackageId: secondSale.customerPackage.id,
        items: [{ serviceId: secondBalance.serviceId, quantity: 1 }],
      })
      .expect(201);
    const confirmed = await request(app)
      .post(`/api/job-carts/${usedCart.body.data.id}/confirm`)
      .set(auth(f.adminToken));
    expect(
      Number(
        (
          await prisma.product.findUniqueOrThrow({
            where: { id: product.id },
          })
        ).currentStock
      )
    ).toBe(8);
    await request(app)
      .patch(`/api/invoices/${confirmed.body.data.invoice.id}/cancel`)
      .set(auth(f.adminToken))
      .expect(200);
    await request(app)
      .patch(`/api/invoices/${confirmed.body.data.invoice.id}/cancel`)
      .set(auth(f.adminToken))
      .expect(409);
    expect(
      (
        await prisma.customerPackageServiceBalance.findUniqueOrThrow({
          where: { id: secondBalance.id },
        })
      ).usedQuantity
    ).toBe(0);
    expect(
      (
        await prisma.customerPackageUsage.findFirstOrThrow({
          where: { invoiceId: confirmed.body.data.invoice.id },
        })
      ).status
    ).toBe("CANCELLED");
    expect(
      Number(
        (
          await prisma.product.findUniqueOrThrow({
            where: { id: product.id },
          })
        ).currentStock
      )
    ).toBe(10);
    expect(
      await prisma.productStockMovement.count({
        where: {
          productId: product.id,
          type: "RETURNED",
          referenceType: "APPOINTMENT_CONSUMABLE_REVERSAL",
          referenceId: usedCart.body.data.id,
        },
      })
    ).toBe(1);
  });

  it("cancels a confirmed redemption job cart with package and stock reversal", async () => {
    const f = await fixture();
    const sale = await sellPackage(f);
    const balance = sale.customerPackage.serviceBalances.find(
      (item) => item.serviceId === f.service.id
    )!;
    const product = await prisma.product.create({
      data: {
        salonId: f.salon.id,
        branchId: f.branch.id,
        name: `Job Cart Reversal ${randomUUID()}`,
        currentStock: 10,
        isServiceConsumable: true,
      },
    });
    await prisma.serviceConsumable.create({
      data: {
        salonId: f.salon.id,
        serviceId: f.service.id,
        productId: product.id,
        quantity: 2,
      },
    });
    const cart = await createRedemptionCart(f, sale, "10");
    await request(app)
      .post(`/api/job-carts/${cart.body.data.id}/package-redemptions`)
      .set(auth(f.adminToken))
      .send({
        customerPackageId: sale.customerPackage.id,
        items: [{ serviceId: f.service.id, quantity: 1 }],
      })
      .expect(201);
    const confirmed = await request(app)
      .post(`/api/job-carts/${cart.body.data.id}/confirm`)
      .set(auth(f.adminToken))
      .expect(200);

    const cancelled = await request(app)
      .post(`/api/job-carts/${cart.body.data.id}/cancel`)
      .set(auth(f.adminToken))
      .expect(200);
    expect(cancelled.body.data.appointmentStatus).toBe("CANCELLED");
    expect(cancelled.body.data.invoice.status).toBe("CANCELLED");
    expect(
      Number(
        (
          await prisma.product.findUniqueOrThrow({
            where: { id: product.id },
          })
        ).currentStock
      )
    ).toBe(10);
    expect(
      (
        await prisma.customerPackageServiceBalance.findUniqueOrThrow({
          where: { id: balance.id },
        })
      ).usedQuantity
    ).toBe(0);
    expect(
      (
        await prisma.customerPackageUsage.findFirstOrThrow({
          where: { invoiceId: confirmed.body.data.invoice.id },
        })
      ).status
    ).toBe("CANCELLED");
  });

  it("rolls back invoice cancellation and stock reversal when its audit fails", async () => {
    const f = await fixture();
    const sale = await sellPackage(f);
    const balance = sale.customerPackage.serviceBalances.find(
      (item) => item.serviceId === f.service.id
    )!;
    const product = await prisma.product.create({
      data: {
        salonId: f.salon.id,
        branchId: f.branch.id,
        name: `Rollback Reversal ${randomUUID()}`,
        currentStock: 10,
        isServiceConsumable: true,
      },
    });
    await prisma.serviceConsumable.create({
      data: {
        salonId: f.salon.id,
        serviceId: f.service.id,
        productId: product.id,
        quantity: 2,
      },
    });
    const cart = await createRedemptionCart(f, sale, "11");
    await request(app)
      .post(`/api/job-carts/${cart.body.data.id}/package-redemptions`)
      .set(auth(f.adminToken))
      .send({
        customerPackageId: sale.customerPackage.id,
        items: [{ serviceId: f.service.id, quantity: 1 }],
      })
      .expect(201);
    const confirmed = await request(app)
      .post(`/api/job-carts/${cart.body.data.id}/confirm`)
      .set(auth(f.adminToken))
      .expect(200);
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_invoice_cancel_audit()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."module" = 'INVOICE' AND NEW."action" = 'CANCEL' THEN
          RAISE EXCEPTION 'forced invoice cancellation audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS fail_invoice_cancel_audit_trigger ON "AuditLog"`
    );
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_invoice_cancel_audit_trigger
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION fail_invoice_cancel_audit()
    `);
    try {
      await request(app)
        .patch(`/api/invoices/${confirmed.body.data.invoice.id}/cancel`)
        .set(auth(f.adminToken))
        .expect(500);
      expect(
        (
          await prisma.invoice.findUniqueOrThrow({
            where: { id: confirmed.body.data.invoice.id },
          })
        ).status
      ).toBe("ISSUED");
      expect(
        Number(
          (
            await prisma.product.findUniqueOrThrow({
              where: { id: product.id },
            })
          ).currentStock
        )
      ).toBe(8);
      expect(
        (
          await prisma.customerPackageServiceBalance.findUniqueOrThrow({
            where: { id: balance.id },
          })
        ).usedQuantity
      ).toBe(1);
      expect(
        await prisma.productStockMovement.count({
          where: {
            productId: product.id,
            type: "RETURNED",
            referenceType: "APPOINTMENT_CONSUMABLE_REVERSAL",
            referenceId: cart.body.data.id,
          },
        })
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS fail_invoice_cancel_audit_trigger ON "AuditLog"`
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS fail_invoice_cancel_audit()`
      );
    }
  });

  it("rolls back reservation when the redemption audit fails", async () => {
    const f = await fixture();
    const sale = await sellPackage(f);
    const balance = sale.customerPackage.serviceBalances[0]!;
    const cart = await createRedemptionCart(f, sale, "08");
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_redemption_reserve_audit()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."module" = 'PACKAGE' AND NEW."action" = 'CREATE'
           AND NEW."description" LIKE 'Package redemption reserved%' THEN
          RAISE EXCEPTION 'forced redemption reserve audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS fail_redemption_reserve_audit_trigger ON "AuditLog"`
    );
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_redemption_reserve_audit_trigger
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION fail_redemption_reserve_audit()
    `);
    try {
      await request(app)
        .post(`/api/job-carts/${cart.body.data.id}/package-redemptions`)
        .set(auth(f.adminToken))
        .send({
          customerPackageId: sale.customerPackage.id,
          items: [{ serviceId: balance.serviceId, quantity: 1 }],
        })
        .expect(500);
      expect(
        (
          await prisma.customerPackageServiceBalance.findUniqueOrThrow({
            where: { id: balance.id },
          })
        ).reservedQuantity
      ).toBe(0);
      expect(
        await prisma.customerPackageUsage.count({
          where: { jobCartAppointmentId: cart.body.data.id },
        })
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS fail_redemption_reserve_audit_trigger ON "AuditLog"`
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS fail_redemption_reserve_audit()`
      );
    }
  });

  it("rolls back confirmation when the redemption-used audit fails", async () => {
    const f = await fixture();
    const sale = await sellPackage(f);
    const balance = sale.customerPackage.serviceBalances[0]!;
    const cart = await createRedemptionCart(f, sale, "09");
    const reserved = await request(app)
      .post(`/api/job-carts/${cart.body.data.id}/package-redemptions`)
      .set(auth(f.adminToken))
      .send({
        customerPackageId: sale.customerPackage.id,
        items: [{ serviceId: balance.serviceId, quantity: 1 }],
      });
    const usageId = reserved.body.data.packageRedemptions[0].id as string;
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_redemption_used_audit()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."module" = 'PACKAGE' AND NEW."action" = 'COMPLETE'
           AND NEW."description" LIKE 'Package redemption used%' THEN
          RAISE EXCEPTION 'forced redemption used audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS fail_redemption_used_audit_trigger ON "AuditLog"`
    );
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_redemption_used_audit_trigger
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION fail_redemption_used_audit()
    `);
    try {
      await request(app)
        .post(`/api/job-carts/${cart.body.data.id}/confirm`)
        .set(auth(f.adminToken))
        .expect(500);
      const unchangedBalance =
        await prisma.customerPackageServiceBalance.findUniqueOrThrow({
          where: { id: balance.id },
        });
      expect(unchangedBalance.reservedQuantity).toBe(1);
      expect(unchangedBalance.usedQuantity).toBe(0);
      expect(
        (
          await prisma.customerPackageUsage.findUniqueOrThrow({
            where: { id: usageId },
          })
        ).status
      ).toBe("RESERVED");
      expect(
        (
          await prisma.appointment.findUniqueOrThrow({
            where: { id: cart.body.data.id },
          })
        ).status
      ).toBe("SCHEDULED");
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS fail_redemption_used_audit_trigger ON "AuditLog"`
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS fail_redemption_used_audit()`
      );
    }
  });
});
