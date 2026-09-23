import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { app } from "../app.js";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { Prisma } from "../generated/prisma/client.js";

/**
 * Verification pass over the location inventory: the aggregate/location
 * invariant, what opening a pack means, the unit a quantity was recorded in,
 * traceability, the reversal policy, concurrency, idempotency, rollback and
 * the permission matrix.
 */
const LONG = 60_000;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const tokenFor = (actor: { id: string; role: string; salonId?: string; branchId?: string }) =>
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

const world = async () => {
  const marker = randomUUID().slice(0, 8);
  const salon = await prisma.salon.create({ data: { name: `Verify ${marker}` } });
  const otherSalon = await prisma.salon.create({ data: { name: `Other ${marker}` } });
  const branchA = await prisma.branch.create({ data: { name: `A ${marker}`, salonId: salon.id } });
  const branchB = await prisma.branch.create({ data: { name: `B ${marker}`, salonId: salon.id } });
  const user = (name: string, role: string, salonId: string, branchId?: string) =>
    prisma.user.create({
      data: {
        name,
        email: `${name}-${marker}@test.com`.toLowerCase(),
        passwordHash: "test",
        role: role as never,
        salonId,
        ...(branchId ? { branchId } : {}),
      },
    });
  const [admin, manager, receptionist, staffUser, superAdmin, otherAdmin, managerB] =
    await Promise.all([
      user("admin", "SALON_ADMIN", salon.id),
      user("manager", "BRANCH_MANAGER", salon.id, branchA.id),
      user("reception", "RECEPTIONIST", salon.id, branchA.id),
      user("staff", "STAFF", salon.id, branchA.id),
      user("super", "SUPER_ADMIN", salon.id),
      user("other", "SALON_ADMIN", otherSalon.id),
      user("managerb", "BRANCH_MANAGER", salon.id, branchB.id),
    ]);
  const staffRow = (name: string, branchId: string) =>
    prisma.staff.create({
      data: {
        name,
        email: `${name}-${marker}@staff.test`.toLowerCase(),
        jobRole: "Stylist",
        workingFrom: "00:00",
        workingTo: "23:59",
        weekOff: "NEVER",
        salonId: salon.id,
        branchId,
      },
    });
  const [rahul, amit] = await Promise.all([staffRow("Rahul", branchA.id), staffRow("Amit", branchA.id)]);
  const customer = await prisma.customer.create({
    data: { customerCode: `V-${marker}`, name: "Asha", phone: `9${Date.now() % 1_000_000_000}`, salonId: salon.id, branchId: branchA.id },
  });
  const category = await prisma.mainService.create({ data: { name: `Main ${marker}`, salonId: salon.id } });
  const service = (name: string) =>
    prisma.service.create({
      data: { name: `${name} ${marker}`, price: 300, durationValue: 30, durationUnit: "MINUTES", salonId: salon.id, mainServiceId: category.id },
    });
  const [wash, spa] = await Promise.all([service("Wash"), service("Spa")]);
  const shampoo = await prisma.product.create({
    data: {
      name: `Shampoo ${marker}`,
      salonId: salon.id,
      branchId: branchA.id,
      unit: "BOTTLE",
      packSize: 1000,
      packUnit: "ML",
      sellingPrice: 400,
      isRetailProduct: true,
      isServiceConsumable: true,
    },
  });
  await prisma.serviceConsumable.createMany({
    data: [
      { salonId: salon.id, serviceId: wash.id, productId: shampoo.id, quantity: 50 },
      { salonId: salon.id, serviceId: spa.id, productId: shampoo.id, quantity: 30 },
    ],
  });
  return {
    salon, otherSalon, branchA, branchB, customer, rahul, amit, wash, spa, shampoo,
    users: { admin, manager, managerB, receptionist, staffUser, superAdmin, otherAdmin },
    token: {
      admin: tokenFor(admin),
      manager: tokenFor(manager),
      managerB: tokenFor(managerB),
      receptionist: tokenFor(receptionist),
      staff: tokenFor(staffUser),
      superAdmin: tokenFor(superAdmin),
      otherAdmin: tokenFor(otherAdmin),
    },
  };
};
type World = Awaited<ReturnType<typeof world>>;

/**
 * currentStock is the number of whole packs the salon holds, wherever they
 * are, including packs that are open and partly used. It must always equal
 * the sum of the location balances.
 */
const expectInvariant = async (productId: string, note: string) => {
  const [product, balances] = await Promise.all([
    prisma.product.findUniqueOrThrow({ where: { id: productId } }),
    prisma.productLocationStock.findMany({ where: { productId } }),
  ]);
  const sum = balances.reduce((total, row) => total.plus(row.quantity), new Prisma.Decimal(0));
  expect({ [note]: product.currentStock.toString() }).toEqual({ [note]: sum.toString() });
  expect(balances.every((row) => row.quantity.greaterThanOrEqualTo(0))).toBe(true);
  return product;
};

const stockAt = async (productId: string, branchId: string | null, location: string) =>
  Number(
    (
      await prisma.productLocationStock.findUnique({
        where: { productId_siteKey_location: { productId, siteKey: branchId ?? "SALON", location: location as never } },
      })
    )?.quantity ?? 0
  );

const api = {
  purchase: (w: World, quantity: number, location = "WAREHOUSE", branchId: string | null = w.branchA.id) =>
    request(app).post("/api/product-purchases").set(auth(w.token.admin)).send({
      ...(branchId ? { branchId } : {}),
      location,
      items: [{ productId: w.shampoo.id, quantity, unitCost: 100 }],
    }),
  transfer: (w: World, token: string, body: Record<string, unknown>) =>
    request(app).post("/api/inventory/transfers").set(auth(token)).send({ productId: w.shampoo.id, ...body }),
  open: (w: World, token: string, body: Record<string, unknown> = {}) =>
    request(app).post("/api/inventory/containers/open").set(auth(token)).send({ productId: w.shampoo.id, openedByStaffId: w.rahul.id, ...body }),
  reconcile: (token: string, containerId: string, body: Record<string, unknown>) =>
    request(app).post(`/api/inventory/containers/${containerId}/reconcile`).set(auth(token)).send(body),
  manual: (w: World, token: string, body: Record<string, unknown>) =>
    request(app)
      .post("/api/stock-movements/manual")
      .set(auth(token))
      // A super admin works across salons, so the salon is named explicitly.
      .send({ productId: w.shampoo.id, salonId: w.salon.id, ...body }),
  sale: (w: World, token: string, quantity: number) =>
    request(app).post("/api/retail-sales").set(auth(token)).send({ branchId: w.branchA.id, items: [{ productId: w.shampoo.id, quantity, unitPrice: 400 }] }),
  view: (w: World, token: string) =>
    request(app).get(`/api/inventory/products/${w.shampoo.id}`).set(auth(token)),
};

/** Fails with the response body, so a wrong status is readable. */
const ok = async (call: request.Test | Promise<request.Response>, status = 201) => {
  const response = await call;
  if (response.status !== status) {
    throw new Error(`expected ${status}, got ${response.status}: ${JSON.stringify(response.body)}`);
  }
  return response;
};

let slot = 0;
const booking = async (w: World, serviceIds: string[]) => {
  slot += 1;
  const start = new Date(Date.UTC(2032, 0, 1) + slot * 3_600_000);
  const services = await prisma.service.findMany({ where: { id: { in: serviceIds } } });
  return prisma.appointment.create({
    data: {
      appointmentCode: `V-${randomUUID().slice(0, 8)}`,
      salonId: w.salon.id,
      branchId: w.branchA.id,
      customerId: w.customer.id,
      staffId: w.rahul.id,
      startTime: start,
      endTime: new Date(start.getTime() + 1_800_000),
      status: "CHECKED_IN",
      services: {
        create: serviceIds.map((serviceId) => {
          const service = services.find((row) => row.id === serviceId)!;
          return { serviceId, serviceName: service.name, price: service.price, staffId: w.rahul.id };
        }),
      },
    },
    include: { services: { orderBy: { createdAt: "asc" } } },
  });
};
const complete = (w: World, appointmentId: string, usage?: unknown[], token = w.token.receptionist) =>
  request(app).patch(`/api/appointments/${appointmentId}/status`).set(auth(token)).send({ status: "COMPLETED", ...(usage ? { usage } : {}) });
const cancel = (w: World, appointmentId: string) =>
  request(app).patch(`/api/appointments/${appointmentId}/status`).set(auth(w.token.receptionist)).send({ status: "CANCELLED" });
const containers = (productId: string) =>
  prisma.productContainer.findMany({ where: { productId }, orderBy: { code: "asc" } });

describe("stock invariant", () => {
  it("holds after every kind of stock event", async () => {
    const w = await world();
    await ok(api.purchase(w, 100));
    expect(Number(await expectInvariant(w.shampoo.id, "purchase")).valueOf()).toBeDefined();
    expect(await stockAt(w.shampoo.id, w.branchA.id, "WAREHOUSE")).toBe(100);

    await ok(api.manual(w, w.token.admin, { type: "ADJUSTMENT", quantity: -4, location: "WAREHOUSE", reason: "Count" }));
    await expectInvariant(w.shampoo.id, "manual adjustment");

    await ok(api.transfer(w, w.token.admin, { branchId: w.branchA.id, fromLocation: "WAREHOUSE", toLocation: "RETAIL", quantity: 15 }));
    await expectInvariant(w.shampoo.id, "warehouse to retail");
    await ok(api.transfer(w, w.token.admin, { branchId: w.branchA.id, fromLocation: "WAREHOUSE", toLocation: "SERVICE", quantity: 5 }));
    const afterTransfers = await expectInvariant(w.shampoo.id, "warehouse to service");
    expect(Number(afterTransfers.currentStock)).toBe(96);

    const opened = await api.open(w, w.token.receptionist, { count: 2 });
    expect(opened.status).toBe(201);
    const afterOpen = await expectInvariant(w.shampoo.id, "opening packs");
    // Opening moved nothing out of stock.
    expect(Number(afterOpen.currentStock)).toBe(96);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "SERVICE")).toBe(5);

    const [first] = opened.body.data.containers;
    const oneLine = await booking(w, [w.wash.id]);
    await ok(complete(w, oneLine.id, [
      { appointmentServiceId: oneLine.services[0]!.id, productId: w.shampoo.id, quantity: 50, containerId: first.id },
    ]), 200);
    await expectInvariant(w.shampoo.id, "service usage");

    // Split across the two open packs, emptying the first.
    await ok(api.reconcile(w.token.manager, first.id, { actualRemaining: 20, reason: "MEASUREMENT" }));
    await expectInvariant(w.shampoo.id, "reconciliation");
    const split = await booking(w, [w.wash.id]);
    await ok(complete(w, split.id), 200);
    const afterSplit = await expectInvariant(w.shampoo.id, "split usage");
    // The emptied pack left stock; the second pack is still there.
    expect(Number(afterSplit.currentStock)).toBe(95);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "SERVICE")).toBe(4);
    const closing = await prisma.productStockMovement.findFirstOrThrow({
      where: { productId: w.shampoo.id, type: "CONTAINER_CLOSED" },
    });
    expect(closing).toMatchObject({ containerId: first.id, unit: "BOTTLE", location: "SERVICE" });

    await ok(api.sale(w, w.token.receptionist, 2));
    await expectInvariant(w.shampoo.id, "retail sale");
    await ok(api.manual(w, w.token.admin, { type: "WASTAGE", quantity: 1, location: "RETAIL", reason: "Leak" }));
    await expectInvariant(w.shampoo.id, "wastage");
    await ok(api.manual(w, w.token.admin, { type: "LOST", quantity: 1, location: "WAREHOUSE", reason: "Missing" }));
    await expectInvariant(w.shampoo.id, "lost");

    await ok(cancel(w, split.id), 200);
    await expectInvariant(w.shampoo.id, "appointment cancellation");
    await ok(cancel(w, oneLine.id), 200);
    const afterReversal = await expectInvariant(w.shampoo.id, "second cancellation");
    // 96 stocked, one pack emptied, two sold, one wasted, one lost, and the
    // emptied pack back in stock with its content.
    expect(Number(afterReversal.currentStock)).toBe(92);
    expect((await containers(w.shampoo.id))[0]).toMatchObject({ status: "OPEN" });

    // Salon-level stock belongs to a salon-wide product; a branch product
    // keeps everything in its own branch.
    const shared = await prisma.product.create({
      data: { name: `Shared ${randomUUID().slice(0, 6)}`, salonId: w.salon.id, unit: "PCS", isServiceConsumable: true },
    });
    await ok(
      request(app).post("/api/product-purchases").set(auth(w.token.admin)).send({
        location: "WAREHOUSE",
        items: [{ productId: shared.id, quantity: 6, unitCost: 10 }],
      })
    );
    await expectInvariant(shared.id, "salon-level purchase");
    await ok(
      request(app).post("/api/inventory/transfers").set(auth(w.token.admin)).send({
        productId: shared.id,
        branchId: w.branchA.id,
        fromSalonStock: true,
        fromLocation: "WAREHOUSE",
        toLocation: "SERVICE",
        quantity: 2,
      })
    );
    await expectInvariant(shared.id, "salon to branch");
    expect(await stockAt(shared.id, null, "WAREHOUSE")).toBe(4);
    expect(await stockAt(shared.id, w.branchA.id, "SERVICE")).toBe(2);
  }, LONG);

  it("keeps a job cart cancellation consistent", async () => {
    const w = await world();
    await api.purchase(w, 10, "RETAIL").expect(201);
    const cart = await request(app).post("/api/job-carts").set(auth(w.token.receptionist)).send({
      branchId: w.branchA.id,
      customerName: "Walk-in",
      phone: "98765 00090",
      startTime: new Date(Date.now() + 7_200_000).toISOString(),
      serviceIds: [w.wash.id],
    });
    expect(cart.status).toBe(201);
    await request(app).post(`/api/job-carts/${cart.body.data.id}/items`).set(auth(w.token.receptionist)).send({ itemType: "PRODUCT", productId: w.shampoo.id, quantity: 2 }).expect(200);
    await request(app).post(`/api/job-carts/${cart.body.data.id}/cancel`).set(auth(w.token.receptionist)).expect(200);
    await expectInvariant(w.shampoo.id, "job cart cancellation");
    expect(await stockAt(w.shampoo.id, w.branchA.id, "RETAIL")).toBe(10);
  }, LONG);
});

describe("units of measure", () => {
  it("records the unit each quantity was measured in", async () => {
    const w = await world();
    await api.purchase(w, 5, "SERVICE").expect(201);
    const [bottle] = (await api.open(w, w.token.receptionist)).body.data.containers;
    const appointment = await booking(w, [w.wash.id]);
    await complete(w, appointment.id).expect(200);
    const rows = await prisma.productStockMovement.findMany({
      where: { productId: w.shampoo.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((row) => [row.type, row.unit])).toEqual([
      ["STOCK_IN", "BOTTLE"],
      ["OPEN_CONTAINER", "BOTTLE"],
      ["USED_IN_SERVICE", "ML"],
    ]);
    const container = await prisma.productContainer.findUniqueOrThrow({ where: { id: bottle.id } });
    expect(container.unit).toBe("ML");
    expect(Number(container.originalQuantity)).toBe(1000);
    expect(Number(container.remainingQuantity)).toBe(950);
  }, LONG);

  it("does not reread older quantities when a pack size is set later", async () => {
    const w = await world();
    const bulk = await prisma.product.create({
      data: { name: `Bulk ${randomUUID().slice(0, 6)}`, salonId: w.salon.id, branchId: w.branchA.id, unit: "ML", isServiceConsumable: true },
    });
    await prisma.serviceConsumable.create({ data: { salonId: w.salon.id, serviceId: w.wash.id, productId: bulk.id, quantity: 40 } });
    // The same service also uses shampoo, so stock and open one.
    await ok(api.purchase(w, 5, "SERVICE"));
    await ok(api.open(w, w.token.receptionist));
    await request(app).post("/api/product-purchases").set(auth(w.token.admin)).send({
      branchId: w.branchA.id, location: "SERVICE", items: [{ productId: bulk.id, quantity: 500, unitCost: 1 }],
    }).expect(201);
    const appointment = await booking(w, [w.wash.id]);
    await complete(w, appointment.id).expect(200);
    const before = await prisma.productStockMovement.findFirstOrThrow({ where: { productId: bulk.id, type: "USED_IN_SERVICE" } });
    expect([before.unit, Number(before.quantity)]).toEqual(["ML", 40]);

    // Giving the product a pack size now must be confirmed, because it
    // changes what its consumable quantities mean.
    const blocked = await request(app).put(`/api/products/${bulk.id}`).set(auth(w.token.admin)).send({ packSize: 500, packUnit: "ML" });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/differ from the stock unit/);
    const needsConfirm = await request(app).put(`/api/products/${bulk.id}`).set(auth(w.token.admin)).send({ unit: "BOTTLE", packSize: 500, packUnit: "ML" });
    expect(needsConfirm.status).toBe(409);
    expect(needsConfirm.body.code).toBe("CONSUMABLE_UNIT_CHANGE");
    const confirmed = await request(app).put(`/api/products/${bulk.id}`).set(auth(w.token.admin)).send({ unit: "BOTTLE", packSize: 500, packUnit: "ML", confirmConsumableUnits: true });
    expect(confirmed.status).toBe(200);

    // The older row is still read as the 40 ML it was, and is reported apart
    // from figures in the new usage unit rather than converted.
    const view = await request(app).get(`/api/inventory/products/${bulk.id}`).set(auth(w.token.admin));
    expect(view.status).toBe(200);
    expect(view.body.data.product).toMatchObject({ containerTracked: true, usageUnit: "ML" });
    const unchanged = await prisma.productStockMovement.findFirstOrThrow({ where: { id: before.id } });
    expect([unchanged.unit, Number(unchanged.quantity)]).toEqual(["ML", 40]);

    // A whole pack written off is in pack units, so it is reported apart from
    // the millilitre figures rather than folded into them.
    await ok(
      request(app).post("/api/stock-movements/manual").set(auth(w.token.admin)).send({
        productId: bulk.id,
        salonId: w.salon.id,
        type: "WASTAGE",
        location: "SERVICE",
        quantity: 1,
        reason: "Pack damaged",
      })
    );
    const afterWriteOff = await request(app).get(`/api/inventory/products/${bulk.id}`).set(auth(w.token.admin));
    expect(afterWriteOff.body.data.discrepancies.wastage).toBe("0");
    expect(afterWriteOff.body.data.movementsInOtherUnits).toEqual(
      expect.arrayContaining([{ unit: "BOTTLE", type: "WASTAGE", quantity: "1" }])
    );
  }, LONG);
});

describe("service usage records", () => {
  it("keeps one expected quantity per service line however many packs supply it", async () => {
    const w = await world();
    await api.purchase(w, 5, "SERVICE").expect(201);
    const [a] = (await api.open(w, w.token.receptionist)).body.data.containers;
    await api.reconcile(w.token.manager, a.id, { actualRemaining: 20, reason: "MEASUREMENT" }).expect(201);
    const [, b] = await Promise.all([null, (await api.open(w, w.token.receptionist)).body.data.containers[0]]);
    const appointment = await booking(w, [w.wash.id]);
    await complete(w, appointment.id, [
      { appointmentServiceId: appointment.services[0]!.id, productId: w.shampoo.id, quantity: 20, containerId: a.id },
      { appointmentServiceId: appointment.services[0]!.id, productId: w.shampoo.id, quantity: 30, containerId: b.id },
    ]).expect(200);

    const view = await api.view(w, w.token.admin);
    const line = view.body.data.usageByService.find((row: { serviceId: string }) => row.serviceId === w.wash.id);
    // Two movements, one service line: expected 50, actual 50.
    expect(line).toMatchObject({ used: "50", lines: 1, averageExpected: "50", averageActual: "50" });
    expect(view.body.data.usage.total).toBe("50");
  }, LONG);

  it("reconstructs each service line of one appointment on its own", async () => {
    const w = await world();
    await api.purchase(w, 5, "SERVICE").expect(201);
    const [bottle] = (await api.open(w, w.token.receptionist)).body.data.containers;
    const appointment = await booking(w, [w.wash.id, w.spa.id]);
    const [lineA, lineB] = appointment.services;
    await complete(w, appointment.id, [
      { appointmentServiceId: lineA!.id, productId: w.shampoo.id, quantity: 60, containerId: bottle.id },
      { appointmentServiceId: lineB!.id, productId: w.shampoo.id, quantity: 35, containerId: bottle.id },
    ]).expect(200);

    const rows = await prisma.productStockMovement.findMany({
      where: { referenceId: appointment.id, type: "USED_IN_SERVICE" },
      include: { container: true, service: true, staff: true, appointmentService: true, createdBy: true },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(
      rows.map((row) => ({
        line: row.appointmentServiceId,
        service: row.service?.name,
        expected: Number(row.expectedQuantity),
        actual: Number(row.quantity),
        unit: row.unit,
        staff: row.staff?.name,
        recordedBy: row.createdBy?.name,
        container: row.container?.code,
        branch: row.branchId,
        referenceType: row.referenceType,
      }))
    ).toEqual([
      { line: lineA!.id, service: w.wash.name, expected: 50, actual: 60, unit: "ML", staff: "Rahul", recordedBy: "reception", container: "SH-001", branch: w.branchA.id, referenceType: "APPOINTMENT" },
      { line: lineB!.id, service: w.spa.name, expected: 30, actual: 35, unit: "ML", staff: "Rahul", recordedBy: "reception", container: "SH-001", branch: w.branchA.id, referenceType: "APPOINTMENT" },
    ]);
    expect(rows.every((row) => row.createdAt instanceof Date)).toBe(true);
    const view = await api.view(w, w.token.admin);
    const services = view.body.data.usageByService;
    expect(services.find((row: { serviceId: string }) => row.serviceId === w.wash.id)).toMatchObject({ used: "60", averageExpected: "50" });
    expect(services.find((row: { serviceId: string }) => row.serviceId === w.spa.id)).toMatchObject({ used: "35", averageExpected: "30" });
  }, LONG);

  it("persists the allocation across two packs exactly as asked", async () => {
    const w = await world();
    await api.purchase(w, 5, "SERVICE").expect(201);
    const [a] = (await api.open(w, w.token.receptionist)).body.data.containers;
    await api.reconcile(w.token.manager, a.id, { actualRemaining: 20, reason: "MEASUREMENT" }).expect(201);
    const [b] = (await api.open(w, w.token.receptionist)).body.data.containers;
    const appointment = await booking(w, [w.wash.id]);
    await complete(w, appointment.id).expect(200);

    const [first, second] = await containers(w.shampoo.id);
    expect({ code: first!.code, remaining: Number(first!.remainingQuantity), status: first!.status }).toEqual({ code: "SH-001", remaining: 0, status: "EMPTY" });
    expect({ code: second!.code, remaining: Number(second!.remainingQuantity), status: second!.status }).toEqual({ code: "SH-002", remaining: 970, status: "OPEN" });
    expect(first!.closedAt).toBeInstanceOf(Date);
    const uses = await prisma.productStockMovement.findMany({
      where: { referenceId: appointment.id, type: "USED_IN_SERVICE" },
      include: { container: true },
    });
    expect(uses.map((row) => [row.container?.code, Number(row.quantity), Number(row.stockBefore), Number(row.stockAfter)]).sort()).toEqual([
      ["SH-001", 20, 20, 0],
      ["SH-002", 30, 1000, 970],
    ]);
    expect(b.id).toBe(second!.id);
  }, LONG);
});

describe("reversal policy", () => {
  const usedOnce = async (w: World, quantity = 50) => {
    await api.purchase(w, 5, "SERVICE").expect(201);
    const [bottle] = (await api.open(w, w.token.receptionist)).body.data.containers;
    const appointment = await booking(w, [w.wash.id]);
    await complete(w, appointment.id, [
      { appointmentServiceId: appointment.services[0]!.id, productId: w.shampoo.id, quantity, containerId: bottle.id },
    ]).expect(200);
    return { bottle, appointment };
  };

  it("puts the content back in the same pack", async () => {
    const w = await world();
    const { bottle, appointment } = await usedOnce(w);
    expect(Number((await prisma.productContainer.findUniqueOrThrow({ where: { id: bottle.id } })).remainingQuantity)).toBe(950);
    await cancel(w, appointment.id).expect(200);
    const after = await prisma.productContainer.findUniqueOrThrow({ where: { id: bottle.id } });
    expect([Number(after.remainingQuantity), after.status]).toEqual([1000, "OPEN"]);
    await expectInvariant(w.shampoo.id, "reversal");
  }, LONG);

  it("still puts it back when the pack was used again afterwards", async () => {
    const w = await world();
    const { bottle, appointment } = await usedOnce(w);
    const later = await booking(w, [w.spa.id]);
    await complete(w, later.id, [
      { appointmentServiceId: later.services[0]!.id, productId: w.shampoo.id, quantity: 30, containerId: bottle.id },
    ]).expect(200);
    await cancel(w, appointment.id).expect(200);
    const after = await prisma.productContainer.findUniqueOrThrow({ where: { id: bottle.id } });
    expect([Number(after.remainingQuantity), after.status]).toEqual([970, "OPEN"]);
  }, LONG);

  it("reopens an emptied pack and takes it back into stock", async () => {
    const w = await world();
    await api.purchase(w, 5, "SERVICE").expect(201);
    const [bottle] = (await api.open(w, w.token.receptionist)).body.data.containers;
    await api.reconcile(w.token.manager, bottle.id, { actualRemaining: 50, reason: "MEASUREMENT" }).expect(201);
    const stockBefore = Number((await prisma.product.findUniqueOrThrow({ where: { id: w.shampoo.id } })).currentStock);
    const appointment = await booking(w, [w.wash.id]);
    await complete(w, appointment.id).expect(200);
    expect((await containers(w.shampoo.id))[0]).toMatchObject({ status: "EMPTY" });
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: w.shampoo.id } })).currentStock)).toBe(stockBefore - 1);

    await cancel(w, appointment.id).expect(200);
    const after = (await containers(w.shampoo.id))[0]!;
    expect([Number(after.remainingQuantity), after.status, after.closedAt]).toEqual([50, "OPEN", null]);
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: w.shampoo.id } })).currentStock)).toBe(stockBefore);
    await expectInvariant(w.shampoo.id, "reopened pack");
    const packRows = await prisma.productStockMovement.findMany({
      where: { containerId: after.id, unit: "BOTTLE" },
      orderBy: { createdAt: "asc" },
    });
    expect(packRows.map((row) => row.type)).toEqual(["OPEN_CONTAINER", "CONTAINER_CLOSED", "RETURNED"]);
  }, LONG);

  it("restores only what fits when the pack was refilled, and says so", async () => {
    const w = await world();
    const { bottle, appointment } = await usedOnce(w);
    await api.reconcile(w.token.manager, bottle.id, { actualRemaining: 1000, reason: "INCORRECT_USAGE" }).expect(201);
    await cancel(w, appointment.id).expect(200);
    const after = await prisma.productContainer.findUniqueOrThrow({ where: { id: bottle.id } });
    expect(Number(after.remainingQuantity)).toBe(1000);
    const logged = await prisma.auditLog.findFirst({
      where: { module: "INVENTORY", description: { contains: "could not be restored" } },
    });
    expect(logged).not.toBeNull();
    await expectInvariant(w.shampoo.id, "no room to restore");
  }, LONG);

  it("does not touch a pack written off as lost, and still cancels", async () => {
    const w = await world();
    const { bottle, appointment } = await usedOnce(w);
    await api.reconcile(w.token.manager, bottle.id, { actualRemaining: 0, reason: "LOST" }).expect(201);
    const lost = await prisma.productContainer.findUniqueOrThrow({ where: { id: bottle.id } });
    expect(lost.status).toBe("LOST");
    const stockAfterLoss = Number((await prisma.product.findUniqueOrThrow({ where: { id: w.shampoo.id } })).currentStock);

    await cancel(w, appointment.id).expect(200);
    const after = await prisma.productContainer.findUniqueOrThrow({ where: { id: bottle.id } });
    expect([Number(after.remainingQuantity), after.status]).toEqual([0, "LOST"]);
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: w.shampoo.id } })).currentStock)).toBe(stockAfterLoss);
    const logged = await prisma.auditLog.findFirst({
      where: { module: "INVENTORY", description: { contains: "could not be restored" } },
    });
    expect(logged?.description).toMatch(/lost/);
    await expectInvariant(w.shampoo.id, "lost pack reversal");
  }, LONG);

  it("restores into the right pack when another one was opened later", async () => {
    const w = await world();
    const { bottle, appointment } = await usedOnce(w);
    const [second] = (await api.open(w, w.token.receptionist)).body.data.containers;
    await cancel(w, appointment.id).expect(200);
    const rows = await containers(w.shampoo.id);
    expect(rows.map((row) => Number(row.remainingQuantity))).toEqual([1000, 1000]);
    const returned = await prisma.productStockMovement.findFirstOrThrow({
      where: { referenceType: "APPOINTMENT_CONSUMABLE_REVERSAL", type: "RETURNED", unit: "ML" },
    });
    expect(returned.containerId).toBe(bottle.id);
    expect(returned.containerId).not.toBe(second.id);
  }, LONG);
});

describe("reconciliation", () => {
  it("records the count, the variance, the reason and who did it", async () => {
    const w = await world();
    await api.purchase(w, 5, "SERVICE").expect(201);
    const [bottle] = (await api.open(w, w.token.receptionist)).body.data.containers;
    await api.reconcile(w.token.manager, bottle.id, { actualRemaining: 600, reason: "MEASUREMENT" }).expect(201);

    const response = await api.reconcile(w.token.manager, bottle.id, { actualRemaining: 520, reason: "SPILLAGE", note: "Knocked over at the basin" });
    expect(response.status).toBe(201);
    const movement = await prisma.productStockMovement.findUniqueOrThrow({
      where: { id: response.body.data.movement.id },
      include: { createdBy: true },
    });
    expect({
      type: movement.type,
      before: Number(movement.stockBefore),
      after: Number(movement.stockAfter),
      variance: Number(movement.stockAfter) - Number(movement.stockBefore),
      quantity: Number(movement.quantity),
      unit: movement.unit,
      reason: movement.reason,
      note: movement.note,
      by: movement.createdBy?.name,
      reference: movement.referenceType,
    }).toEqual({
      type: "WASTAGE",
      before: 600,
      after: 520,
      variance: -80,
      quantity: 80,
      unit: "ML",
      reason: "Spillage",
      note: "Knocked over at the basin",
      by: "manager",
      reference: "RECONCILE",
    });
    expect(movement.createdAt).toBeInstanceOf(Date);
    expect(Number((await prisma.productContainer.findUniqueOrThrow({ where: { id: bottle.id } })).remainingQuantity)).toBe(520);

    // A count is never filed as service usage, and stays distinguishable from
    // wastage somebody recorded knowingly.
    const view = await api.view(w, w.token.admin);
    // The count found 480 ml less than the system held: 400 booked as a
    // measurement adjustment, 80 as spillage.
    expect(view.body.data.discrepancies).toMatchObject({ serviceUsage: "0", wastage: "80", foundOnReconciliation: "-480" });
    expect(await prisma.productStockMovement.count({ where: { productId: w.shampoo.id, type: "USED_IN_SERVICE" } })).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: movement.id } });
    expect(audit.oldData).toMatchObject({ remainingQuantity: "600" });
    expect(audit.newData).toMatchObject({ remainingQuantity: "520", reason: "Spillage" });
  }, LONG);
});

describe("concurrency", () => {
  it("lets one of two transfers take from five, never both", async () => {
    const w = await world();
    await api.purchase(w, 5).expect(201);
    const body = { branchId: w.branchA.id, fromLocation: "WAREHOUSE", toLocation: "RETAIL", quantity: 4 };
    const results = await Promise.all([
      api.transfer(w, w.token.admin, body),
      api.transfer(w, w.token.admin, body),
    ]);
    expect(results.map((row) => row.status).sort()).toEqual([201, 400]);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "WAREHOUSE")).toBe(1);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "RETAIL")).toBe(4);
    await expectInvariant(w.shampoo.id, "concurrent transfers");
  }, LONG);

  it("lets one of two services take the last 40 ml", async () => {
    const w = await world();
    await api.purchase(w, 5, "SERVICE").expect(201);
    const [bottle] = (await api.open(w, w.token.receptionist)).body.data.containers;
    await api.reconcile(w.token.manager, bottle.id, { actualRemaining: 50, reason: "MEASUREMENT" }).expect(201);
    const first = await booking(w, [w.wash.id]);
    const second = await booking(w, [w.wash.id]);
    const usage = (id: string, lineId: string) =>
      complete(w, id, [{ appointmentServiceId: lineId, productId: w.shampoo.id, quantity: 40, containerId: bottle.id }]);
    const results = await Promise.all([
      usage(first.id, first.services[0]!.id),
      usage(second.id, second.services[0]!.id),
    ]);
    expect(results.map((row) => row.status).sort()).toEqual([200, 400]);
    expect(Number((await prisma.productContainer.findUniqueOrThrow({ where: { id: bottle.id } })).remainingQuantity)).toBe(10);
    expect(await prisma.productStockMovement.count({ where: { containerId: bottle.id, type: "USED_IN_SERVICE" } })).toBe(1);
  }, LONG);

  it("lets one of two retail sales take the last unit", async () => {
    const w = await world();
    await api.purchase(w, 1, "RETAIL").expect(201);
    const results = await Promise.all([
      api.sale(w, w.token.receptionist, 1),
      api.sale(w, w.token.receptionist, 1),
    ]);
    expect(results.map((row) => row.status).sort()).toEqual([201, 400]);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "RETAIL")).toBe(0);
    expect(await expectInvariant(w.shampoo.id, "concurrent sales")).toMatchObject({ currentStock: new Prisma.Decimal(0) });
  }, LONG);
});

describe("duplicate submissions", () => {
  it("applies a repeated transfer, opening and reconciliation once", async () => {
    const w = await world();
    await api.purchase(w, 10, "SERVICE").expect(201);
    const transferId = randomUUID();
    const body = { branchId: w.branchA.id, fromLocation: "SERVICE", toLocation: "RETAIL", quantity: 2, requestId: transferId };
    await api.transfer(w, w.token.admin, body).expect(201);
    await api.transfer(w, w.token.admin, body).expect(200);
    expect(await prisma.productStockMovement.count({ where: { referenceId: transferId } })).toBe(1);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "RETAIL")).toBe(2);

    const openId = randomUUID();
    await api.open(w, w.token.receptionist, { requestId: openId }).expect(201);
    await api.open(w, w.token.receptionist, { requestId: openId }).expect(200);
    expect(await prisma.productContainer.count({ where: { productId: w.shampoo.id } })).toBe(1);

    const [bottle] = await containers(w.shampoo.id);
    const reconcileId = randomUUID();
    await api.reconcile(w.token.manager, bottle!.id, { actualRemaining: 900, reason: "SPILLAGE", requestId: reconcileId }).expect(201);
    await api.reconcile(w.token.manager, bottle!.id, { actualRemaining: 900, reason: "SPILLAGE", requestId: reconcileId }).expect(200);
    expect(await prisma.productStockMovement.count({ where: { containerId: bottle!.id, type: "WASTAGE" } })).toBe(1);
    await expectInvariant(w.shampoo.id, "duplicates");
  }, LONG);

  it("books a repeated completion once, sequentially and at the same time", async () => {
    const w = await world();
    await api.purchase(w, 5, "SERVICE").expect(201);
    const [bottle] = (await api.open(w, w.token.receptionist)).body.data.containers;
    const appointment = await booking(w, [w.wash.id]);
    const usage = [{ appointmentServiceId: appointment.services[0]!.id, productId: w.shampoo.id, quantity: 50, containerId: bottle.id }];
    await complete(w, appointment.id, usage).expect(200);
    await complete(w, appointment.id, usage).expect(400);

    const parallel = await booking(w, [w.wash.id]);
    const parallelUsage = [{ appointmentServiceId: parallel.services[0]!.id, productId: w.shampoo.id, quantity: 50, containerId: bottle.id }];
    const results = await Promise.all([
      complete(w, parallel.id, parallelUsage),
      complete(w, parallel.id, parallelUsage),
    ]);
    expect(results.filter((row) => row.status === 200)).toHaveLength(1);
    expect(await prisma.productStockMovement.count({ where: { containerId: bottle.id, type: "USED_IN_SERVICE" } })).toBe(2);
    expect(Number((await prisma.productContainer.findUniqueOrThrow({ where: { id: bottle.id } })).remainingQuantity)).toBe(900);
  }, LONG);
});

describe("rollback", () => {
  const failAudits = async () => {
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION inventory_test_fail_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced audit failure'; END; $$ LANGUAGE plpgsql`
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER force_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION inventory_test_fail_audit()`
    );
  };
  const restoreAudits = () =>
    prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS force_audit_failure ON "AuditLog"`);

  it("leaves nothing behind when the audit write fails", async () => {
    const w = await world();
    await api.purchase(w, 5, "SERVICE").expect(201);
    const [bottle] = (await api.open(w, w.token.receptionist)).body.data.containers;
    const appointment = await booking(w, [w.wash.id]);
    await failAudits();
    try {
      await complete(w, appointment.id).expect(500);
      await api.open(w, w.token.receptionist).expect(500);
    } finally {
      await restoreAudits();
    }
    expect(Number((await prisma.productContainer.findUniqueOrThrow({ where: { id: bottle.id } })).remainingQuantity)).toBe(1000);
    expect(await prisma.productContainer.count({ where: { productId: w.shampoo.id } })).toBe(1);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("CHECKED_IN");
    expect(await prisma.productStockMovement.count({ where: { referenceId: appointment.id } })).toBe(0);
    await expectInvariant(w.shampoo.id, "audit failure");
  }, LONG);

  it("keeps the first pack untouched when a later allocation is rejected", async () => {
    const w = await world();
    await api.purchase(w, 5, "SERVICE").expect(201);
    const [first] = (await api.open(w, w.token.receptionist)).body.data.containers;
    const appointment = await booking(w, [w.wash.id, w.spa.id]);
    const response = await complete(w, appointment.id, [
      { appointmentServiceId: appointment.services[0]!.id, productId: w.shampoo.id, quantity: 50, containerId: first.id },
      { appointmentServiceId: appointment.services[1]!.id, productId: w.shampoo.id, quantity: 30, containerId: randomUUID() },
    ]);
    expect(response.status).toBe(404);
    expect(Number((await prisma.productContainer.findUniqueOrThrow({ where: { id: first.id } })).remainingQuantity)).toBe(1000);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("CHECKED_IN");
    expect(await prisma.productStockMovement.count({ where: { referenceId: appointment.id } })).toBe(0);
  }, LONG);

  it("keeps stock and the bill together when a job cart payment is rejected", async () => {
    const w = await world();
    await api.purchase(w, 10, "RETAIL").expect(201);
    await api.transfer(w, w.token.admin, { branchId: w.branchA.id, fromLocation: "RETAIL", toLocation: "SERVICE", quantity: 5 }).expect(201);
    const [bottle] = (await api.open(w, w.token.receptionist)).body.data.containers;
    const cart = await request(app).post("/api/job-carts").set(auth(w.token.receptionist)).send({
      branchId: w.branchA.id,
      customerName: "Walk-in",
      phone: "98765 00091",
      startTime: new Date(Date.now() + 10_800_000).toISOString(),
      serviceIds: [w.wash.id],
    });
    expect(cart.status).toBe(201);
    const id = cart.body.data.id as string;
    await request(app).post(`/api/job-carts/${id}/items`).set(auth(w.token.receptionist)).send({ itemType: "PRODUCT", productId: w.shampoo.id, quantity: 1 }).expect(200);
    const lineId = (await prisma.appointmentService.findFirstOrThrow({ where: { appointmentId: id } })).id;
    const failed = await request(app).post(`/api/job-carts/${id}/confirm`).set(auth(w.token.receptionist)).send({
      usage: [{ appointmentServiceId: lineId, productId: w.shampoo.id, quantity: 50, containerId: bottle.id }],
      payments: [{ method: "CASH", amount: 999_999 }],
    });
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect(Number((await prisma.productContainer.findUniqueOrThrow({ where: { id: bottle.id } })).remainingQuantity)).toBe(1000);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "RETAIL")).toBe(5);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id } })).status).toBe("SCHEDULED");
    expect(await prisma.invoice.findFirstOrThrow({ where: { appointmentId: id } })).toMatchObject({ status: "DRAFT", paymentStatus: "UNPAID" });
    await expectInvariant(w.shampoo.id, "failed confirm");
  }, LONG);
});

describe("branch boundaries and permissions", () => {
  it("moves salon-level stock into a branch but never between branches", async () => {
    const w = await world();
    const shared = await prisma.product.create({
      data: { name: `Shared ${randomUUID().slice(0, 6)}`, salonId: w.salon.id, unit: "PCS", isRetailProduct: true, isServiceConsumable: true },
    });
    const move = (token: string, body: Record<string, unknown>) =>
      request(app).post("/api/inventory/transfers").set(auth(token)).send({ productId: shared.id, ...body });
    await request(app).post("/api/product-purchases").set(auth(w.token.admin)).send({ location: "WAREHOUSE", items: [{ productId: shared.id, quantity: 20, unitCost: 5 }] }).expect(201);
    expect(await stockAt(shared.id, null, "WAREHOUSE")).toBe(20);

    for (const [toLocation, quantity] of [["WAREHOUSE", 4], ["RETAIL", 3], ["SERVICE", 2]] as const) {
      await move(w.token.admin, { branchId: w.branchA.id, fromSalonStock: true, fromLocation: "WAREHOUSE", toLocation, quantity }).expect(201);
    }
    expect(await stockAt(shared.id, w.branchA.id, "WAREHOUSE")).toBe(4);
    expect(await stockAt(shared.id, w.branchA.id, "RETAIL")).toBe(3);
    expect(await stockAt(shared.id, w.branchA.id, "SERVICE")).toBe(2);
    expect(await stockAt(shared.id, null, "WAREHOUSE")).toBe(11);
    await move(w.token.admin, { branchId: w.branchA.id, fromLocation: "WAREHOUSE", toLocation: "RETAIL", quantity: 1 }).expect(201);

    // Branch B cannot reach branch A stock: its own balances are empty and a
    // branch id in the body is ignored for a branch-locked caller.
    const acrossBranches = await move(w.token.managerB, { branchId: w.branchA.id, fromLocation: "WAREHOUSE", toLocation: "RETAIL", quantity: 1 });
    expect(acrossBranches.status).toBe(400);
    expect(acrossBranches.body.stock).toMatchObject({ branchId: w.branchB.id, available: 0 });
    expect(await stockAt(shared.id, w.branchA.id, "WAREHOUSE")).toBe(3);
    expect(await stockAt(shared.id, w.branchB.id, "RETAIL")).toBe(0);
    await expectInvariant(shared.id, "salon to branch");
  }, LONG);

  it("applies the same permission matrix at the API", async () => {
    const w = await world();
    const [bottle] = (await (async () => {
      await api.purchase(w, 40, "SERVICE").expect(201);
      return api.open(w, w.token.admin);
    })()).body.data.containers;
    const roles = ["superAdmin", "admin", "manager", "receptionist", "staff", "otherAdmin"] as const;
    // Every role tries every operation against stock that is always there, so
    // the only thing the answer can depend on is the role.
    const operations: Record<string, (token: string, role: string) => Promise<request.Response>> = {
      "view inventory": (token) => api.view(w, token),
      "transfer to retail": async (token) => {
        await api.purchase(w, 2, "WAREHOUSE").expect(201);
        return api.transfer(w, token, { branchId: w.branchA.id, fromLocation: "WAREHOUSE", toLocation: "RETAIL", quantity: 1 });
      },
      "transfer to service": async (token) => {
        await api.purchase(w, 2, "WAREHOUSE").expect(201);
        return api.transfer(w, token, { branchId: w.branchA.id, fromLocation: "WAREHOUSE", toLocation: "SERVICE", quantity: 1 });
      },
      "open a pack": async (token) => {
        await api.purchase(w, 2, "SERVICE").expect(201);
        return api.open(w, token);
      },
      reconcile: (token, role) =>
        api.reconcile(token, bottle.id, { actualRemaining: 900 - roles.indexOf(role as never) * 10, reason: "SPILLAGE" }),
      "record wastage": async (token) => {
        await api.purchase(w, 2, "WAREHOUSE").expect(201);
        return api.manual(w, token, { type: "WASTAGE", quantity: 1, location: "WAREHOUSE", reason: "Check" });
      },
    };
    const expected: Record<string, Record<(typeof roles)[number], number>> = {
      "view inventory": { superAdmin: 200, admin: 200, manager: 200, receptionist: 200, staff: 200, otherAdmin: 404 },
      "transfer to retail": { superAdmin: 201, admin: 201, manager: 201, receptionist: 201, staff: 403, otherAdmin: 404 },
      "transfer to service": { superAdmin: 201, admin: 201, manager: 201, receptionist: 201, staff: 201, otherAdmin: 404 },
      "open a pack": { superAdmin: 201, admin: 201, manager: 201, receptionist: 201, staff: 201, otherAdmin: 404 },
      reconcile: { superAdmin: 201, admin: 201, manager: 201, receptionist: 403, staff: 403, otherAdmin: 404 },
      "record wastage": { superAdmin: 201, admin: 201, manager: 201, receptionist: 403, staff: 403, otherAdmin: 404 },
    };
    const seen: Record<string, Record<string, number>> = {};
    for (const [operation, call] of Object.entries(operations)) {
      seen[operation] = {};
      for (const role of roles) {
        const response = await call(w.token[role], role);
        seen[operation]![role] = response.status;
      }
    }
    expect(seen).toEqual(expected);
    await expectInvariant(w.shampoo.id, "permission matrix");
  }, LONG);
});
