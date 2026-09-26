import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { app } from "../app.js";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { Prisma, type InventoryLocation } from "../generated/prisma/client.js";
import { transferStock } from "../features/stock/stockMovement.service.js";

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
const LONG = 60_000;

/**
 * Shampoo in 1000 ml bottles (salon-wide, opened into containers), gloves
 * counted in pieces (branch product, no containers), Hair Wash uses 50 ml of
 * shampoo, Hair Spa 80 ml, Manicure 2 gloves.
 */
const world = async () => {
  const marker = randomUUID().slice(0, 8);
  const salon = await prisma.salon.create({ data: { name: `Inventory Salon ${marker}` } });
  const otherSalon = await prisma.salon.create({ data: { name: `Other Salon ${marker}` } });
  const branchA = await prisma.branch.create({ data: { name: `Main ${marker}`, salonId: salon.id } });
  const branchB = await prisma.branch.create({ data: { name: `Second ${marker}`, salonId: salon.id } });
  const user = (name: string, role: string, salonId: string, branchId?: string) =>
    prisma.user.create({
      data: {
        name,
        email: `${name.toLowerCase().replace(/\s/g, ".")}-${marker}@test.com`,
        passwordHash: "test",
        role: role as never,
        salonId,
        ...(branchId ? { branchId } : {}),
      },
    });
  const [admin, manager, managerB, receptionist, receptionistB, staffUser, otherAdmin] =
    await Promise.all([
      user("Admin", "SALON_ADMIN", salon.id),
      user("Manager", "BRANCH_MANAGER", salon.id, branchA.id),
      user("Manager B", "BRANCH_MANAGER", salon.id, branchB.id),
      user("Receptionist", "RECEPTIONIST", salon.id, branchA.id),
      user("Receptionist B", "RECEPTIONIST", salon.id, branchB.id),
      user("Staff User", "STAFF", salon.id, branchA.id),
      user("Other Admin", "SALON_ADMIN", otherSalon.id),
    ]);
  const staff = (name: string, branchId: string) =>
    prisma.staff.create({
      data: {
        name,
        email: `${name.toLowerCase()}-${marker}@test.com`,
        jobRole: "Stylist",
        workingFrom: "00:00",
        workingTo: "23:59",
        weekOff: "NEVER",
        salonId: salon.id,
        branchId,
      },
    });
  const [rahul, amit, bina] = await Promise.all([
    staff("Rahul", branchA.id),
    staff("Amit", branchA.id),
    staff("Bina", branchB.id),
  ]);
  const customer = await prisma.customer.create({
    data: { customerCode: `C-${marker}`, name: "Asha", phone: `9${Date.now() % 1_000_000_000}`, salonId: salon.id, branchId: branchA.id },
  });
  const category = await prisma.mainService.create({ data: { name: `Hair ${marker}`, salonId: salon.id } });
  const service = (name: string, price: number) =>
    prisma.service.create({
      data: { name, price, durationValue: 30, durationUnit: "MINUTES", salonId: salon.id, mainServiceId: category.id },
    });
  const [hairWash, hairSpa, manicure, haircut] = await Promise.all([
    service(`Hair Wash ${marker}`, 300),
    service(`Hair Spa ${marker}`, 900),
    service(`Manicure ${marker}`, 400),
    service(`Haircut ${marker}`, 500),
  ]);
  const shampoo = await prisma.product.create({
    data: {
      name: `Shampoo ${marker}`,
      salonId: salon.id,
      unit: "BOTTLE",
      packSize: 1000,
      packUnit: "ML",
      sellingPrice: 400,
      costPrice: 200,
      isRetailProduct: true,
      isServiceConsumable: true,
    },
  });
  const gloves = await prisma.product.create({
    data: {
      name: `Gloves ${marker}`,
      salonId: salon.id,
      branchId: branchA.id,
      unit: "PCS",
      isServiceConsumable: true,
    },
  });
  await prisma.serviceConsumable.createMany({
    data: [
      { salonId: salon.id, serviceId: hairWash.id, productId: shampoo.id, quantity: 50 },
      { salonId: salon.id, serviceId: hairSpa.id, productId: shampoo.id, quantity: 80 },
      { salonId: salon.id, serviceId: manicure.id, productId: gloves.id, quantity: 2 },
    ],
  });
  return {
    salon, otherSalon, branchA, branchB, customer, rahul, amit, bina,
    hairWash, hairSpa, manicure, haircut, shampoo, gloves,
    users: { admin, manager, managerB, receptionist, receptionistB, staffUser, otherAdmin },
    token: {
      admin: tokenFor(admin),
      manager: tokenFor(manager),
      managerB: tokenFor(managerB),
      receptionist: tokenFor(receptionist),
      receptionistB: tokenFor(receptionistB),
      staff: tokenFor(staffUser),
      otherAdmin: tokenFor(otherAdmin),
    },
  };
};
type World = Awaited<ReturnType<typeof world>>;

const stockAt = async (productId: string, branchId: string | null, location: InventoryLocation) =>
  Number(
    (
      await prisma.productLocationStock.findUnique({
        where: { productId_siteKey_location: { productId, siteKey: branchId ?? "SALON", location } },
      })
    )?.quantity ?? 0
  );
const currentStock = async (productId: string) =>
  Number((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).currentStock);

const purchase = (w: World, productId: string, quantity: number, location?: string, branchId: string | null = w.branchA.id) =>
  request(app)
    .post("/api/product-purchases")
    .set(auth(w.token.admin))
    .send({
      ...(branchId ? { branchId } : {}),
      ...(location ? { location } : {}),
      items: [{ productId, quantity, unitCost: 100 }],
    });
const transfer = (w: World, token: string, body: Record<string, unknown>) =>
  request(app).post("/api/inventory/transfers").set(auth(token)).send({ productId: w.shampoo.id, ...body });
const openBottle = (w: World, token: string, body: Record<string, unknown> = {}) =>
  request(app)
    .post("/api/inventory/containers/open")
    .set(auth(token))
    .send({ productId: w.shampoo.id, openedByStaffId: w.rahul.id, reason: "Normal usage", ...body });
const reconcile = (token: string, containerId: string, body: Record<string, unknown>) =>
  request(app).post(`/api/inventory/containers/${containerId}/reconcile`).set(auth(token)).send(body);

/** Purchase 100 bottles into branch A: Warehouse 80, Retail 15, Service 5. */
const stocked = async (w: World) => {
  expect((await purchase(w, w.shampoo.id, 100, "WAREHOUSE")).status).toBe(201);
  expect((await transfer(w, w.token.admin, { branchId: w.branchA.id, fromLocation: "WAREHOUSE", toLocation: "RETAIL", quantity: 15 })).status).toBe(201);
  expect((await transfer(w, w.token.admin, { branchId: w.branchA.id, fromLocation: "WAREHOUSE", toLocation: "SERVICE", quantity: 5, issuedByStaffId: w.amit.id, receivedByStaffId: w.rahul.id })).status).toBe(201);
};

let slot = 0;
/** A checked-in appointment in branch A with one line per service. */
const booking = async (w: World, serviceIds: string[], branchId = w.branchA.id) => {
  slot += 1;
  const start = new Date(Date.UTC(2031, 0, 1, 0, 0) + slot * 3_600_000);
  const services = await prisma.service.findMany({ where: { id: { in: serviceIds } } });
  return prisma.appointment.create({
    data: {
      appointmentCode: `APT-${randomUUID().slice(0, 8)}`,
      salonId: w.salon.id,
      branchId,
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
  request(app)
    .patch(`/api/appointments/${appointmentId}/status`)
    .set(auth(token))
    .send({ status: "COMPLETED", ...(usage ? { usage } : {}) });

const containers = (productId: string) =>
  prisma.productContainer.findMany({ where: { productId }, orderBy: { code: "asc" } });

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

describe("location stock and transfers", () => {
  it("receives a purchase into the warehouse and tracks each location separately", async () => {
    const w = await world();
    const response = await purchase(w, w.shampoo.id, 100, "WAREHOUSE");
    expect(response.status).toBe(201);
    const stockIn = await prisma.productStockMovement.findFirstOrThrow({ where: { productId: w.shampoo.id, type: "STOCK_IN" } });
    expect(stockIn).toMatchObject({ location: "WAREHOUSE", branchId: w.branchA.id, referenceType: "PRODUCT_PURCHASE" });
    expect(Number(stockIn.quantity)).toBe(100);

    expect((await transfer(w, w.token.admin, { branchId: w.branchA.id, fromLocation: "WAREHOUSE", toLocation: "RETAIL", quantity: 15 })).status).toBe(201);
    expect((await transfer(w, w.token.admin, { branchId: w.branchA.id, fromLocation: "WAREHOUSE", toLocation: "SERVICE", quantity: 5 })).status).toBe(201);

    expect(await stockAt(w.shampoo.id, w.branchA.id, "WAREHOUSE")).toBe(80);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "RETAIL")).toBe(15);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "SERVICE")).toBe(5);
    // Transfers never change the product total.
    expect(await currentStock(w.shampoo.id)).toBe(100);
    const transfers = await prisma.productStockMovement.findMany({ where: { productId: w.shampoo.id, type: "TRANSFER" }, orderBy: { createdAt: "asc" } });
    expect(transfers.map((row) => [row.location, row.toLocation, Number(row.quantity)])).toEqual([
      ["WAREHOUSE", "RETAIL", 15],
      ["WAREHOUSE", "SERVICE", 5],
    ]);
  }, LONG);

  it("rejects a transfer larger than the source and changes nothing", async () => {
    const w = await world();
    await stocked(w);
    const response = await transfer(w, w.token.admin, { branchId: w.branchA.id, fromLocation: "RETAIL", toLocation: "SERVICE", quantity: 16 });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, code: "INSUFFICIENT_STOCK", stock: { location: "RETAIL", available: 15, needed: 16 } });
    expect(await stockAt(w.shampoo.id, w.branchA.id, "RETAIL")).toBe(15);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "SERVICE")).toBe(5);
    expect(await prisma.productStockMovement.count({ where: { productId: w.shampoo.id, type: "TRANSFER" } })).toBe(2);
  }, LONG);

  it("moves salon-level stock into a branch, never another branch's stock", async () => {
    const w = await world();
    expect((await purchase(w, w.shampoo.id, 10, "WAREHOUSE", null)).status).toBe(201);
    expect(await stockAt(w.shampoo.id, null, "WAREHOUSE")).toBe(10);
    // Branch B reception pulls from salon-level stock onto its own shelf.
    const pulled = await transfer(w, w.token.receptionistB, { fromLocation: "WAREHOUSE", toLocation: "RETAIL", quantity: 3, fromSalonStock: true, branchId: w.branchA.id });
    expect(pulled.status).toBe(201);
    expect(await stockAt(w.shampoo.id, w.branchB.id, "RETAIL")).toBe(3);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "RETAIL")).toBe(0);
    expect(pulled.body.data.movement).toMatchObject({ branchId: null, toBranchId: w.branchB.id, location: "WAREHOUSE", toLocation: "RETAIL" });

    // Branch A stock cannot be spent by branch B: its own warehouse is empty.
    await transfer(w, w.token.admin, { branchId: w.branchA.id, fromLocation: "WAREHOUSE", toLocation: "WAREHOUSE", fromSalonStock: true, quantity: 5 }).expect(201);
    const denied = await transfer(w, w.token.receptionistB, { fromLocation: "WAREHOUSE", toLocation: "RETAIL", quantity: 1 });
    expect(denied.status).toBe(400);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "WAREHOUSE")).toBe(5);
  }, LONG);

  it("keeps a failed transfer from leaving partial changes", async () => {
    const w = await world();
    await stocked(w);
    await failAudits();
    try {
      await transfer(w, w.token.admin, { branchId: w.branchA.id, fromLocation: "WAREHOUSE", toLocation: "RETAIL", quantity: 5 }).expect(500);
    } finally {
      await restoreAudits();
    }
    expect(await stockAt(w.shampoo.id, w.branchA.id, "WAREHOUSE")).toBe(80);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "RETAIL")).toBe(15);
    expect(await prisma.productStockMovement.count({ where: { productId: w.shampoo.id, type: "TRANSFER" } })).toBe(2);
  }, LONG);

  it("moves stock once for a repeated transfer request", async () => {
    const w = await world();
    await stocked(w);
    const body = { branchId: w.branchA.id, fromLocation: "WAREHOUSE", toLocation: "RETAIL", quantity: 2, requestId: randomUUID() };
    const [first, second] = await Promise.all([transfer(w, w.token.admin, body), transfer(w, w.token.admin, body)]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "RETAIL")).toBe(17);
    expect(await prisma.productStockMovement.count({ where: { referenceId: body.requestId } })).toBe(1);
  }, LONG);

  it("lets only one of two concurrent transfers take the last unit", async () => {
    const w = await world();
    await purchase(w, w.shampoo.id, 1, "WAREHOUSE").expect(201);
    const body = { branchId: w.branchA.id, fromLocation: "WAREHOUSE", toLocation: "RETAIL", quantity: 1 };
    const results = await Promise.all([transfer(w, w.token.admin, body), transfer(w, w.token.admin, body)]);
    expect(results.map((row) => row.status).sort()).toEqual([201, 400]);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "WAREHOUSE")).toBe(0);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "RETAIL")).toBe(1);
  }, LONG);

  it("rolls back every balance when a transfer fails inside a transaction", async () => {
    const w = await world();
    await stocked(w);
    await expect(
      prisma.$transaction(async (tx) => {
        await transferStock({ tx, salonId: w.salon.id, productId: w.shampoo.id, quantity: 5, fromBranchId: w.branchA.id, fromLocation: "WAREHOUSE", toBranchId: w.branchA.id, toLocation: "RETAIL" });
        throw new Error("movement write failed");
      })
    ).rejects.toThrow("movement write failed");
    expect(await stockAt(w.shampoo.id, w.branchA.id, "WAREHOUSE")).toBe(80);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "RETAIL")).toBe(15);
  }, LONG);
});

describe("opened containers and service usage", () => {
  it("opens a bottle from service stock and tracks it individually", async () => {
    const w = await world();
    await stocked(w);
    const opened = await openBottle(w, w.token.receptionist);
    expect(opened.status).toBe(201);
    const [bottle] = opened.body.data.containers;
    expect(bottle).toMatchObject({ code: expect.stringMatching(/^SH-001$/), status: "OPEN", unit: "ML", location: "SERVICE", branchId: w.branchA.id, openedByStaffId: w.rahul.id });
    expect(Number(bottle.originalQuantity)).toBe(1000);
    expect(Number(bottle.remainingQuantity)).toBe(1000);
    // Opening is not consumption: the pack is still in service stock and in
    // the product total, it is simply no longer sealed.
    expect(await stockAt(w.shampoo.id, w.branchA.id, "SERVICE")).toBe(5);
    expect(await currentStock(w.shampoo.id)).toBe(100);
    const opening = await prisma.productStockMovement.findFirstOrThrow({ where: { containerId: bottle.id, type: "OPEN_CONTAINER" } });
    expect(opening).toMatchObject({ staffId: w.rahul.id, reason: "Normal usage", location: "SERVICE", unit: "BOTTLE" });
    expect(Number(opening.stockBefore)).toBe(Number(opening.stockAfter));
    // Sealed stock is what is left once the open packs are set aside.
    const view = await request(app).get(`/api/inventory/products/${w.shampoo.id}`).set(auth(w.token.admin));
    expect(view.body.data.sites.find((site: { branchId: string }) => site.branchId === w.branchA.id)).toMatchObject({ SERVICE: "5", sealedService: "4", openContainers: 1 });
  }, LONG);

  it("always allows opening another bottle while one is open", async () => {
    const w = await world();
    await stocked(w);
    await openBottle(w, w.token.receptionist).expect(201);
    await openBottle(w, w.token.receptionist, { openedByStaffId: w.amit.id, reason: "Bottle misplaced" }).expect(201);
    const open = await containers(w.shampoo.id);
    expect(open.map((row) => [row.code, row.status])).toEqual([["SH-001", "OPEN"], ["SH-002", "OPEN"]]);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "SERVICE")).toBe(5);
    expect(await currentStock(w.shampoo.id)).toBe(100);
    // Two of the five packs are open, so three can still be opened or moved.
    const blocked = await transfer(w, w.token.admin, { branchId: w.branchA.id, fromLocation: "SERVICE", toLocation: "RETAIL", quantity: 4 });
    expect(blocked.status).toBe(400);
    expect(blocked.body.stock).toMatchObject({ location: "SERVICE", available: 3, needed: 4 });
    await transfer(w, w.token.admin, { branchId: w.branchA.id, fromLocation: "SERVICE", toLocation: "RETAIL", quantity: 3 }).expect(201);
  }, LONG);

  it("records service usage against the line, service, staff and container", async () => {
    const w = await world();
    await stocked(w);
    const [bottle] = (await openBottle(w, w.token.receptionist)).body.data.containers;
    const appointment = await booking(w, [w.hairWash.id]);
    const line = appointment.services[0]!;
    const response = await complete(w, appointment.id, [
      { appointmentServiceId: line.id, productId: w.shampoo.id, quantity: 50, containerId: bottle.id },
    ]);
    expect(response.status).toBe(200);
    const after = await prisma.productContainer.findUniqueOrThrow({ where: { id: bottle.id } });
    expect(Number(after.remainingQuantity)).toBe(950);
    const movement = await prisma.productStockMovement.findFirstOrThrow({ where: { type: "USED_IN_SERVICE", containerId: bottle.id } });
    expect(movement).toMatchObject({
      referenceType: "APPOINTMENT",
      referenceId: appointment.id,
      appointmentServiceId: line.id,
      serviceId: w.hairWash.id,
      staffId: w.rahul.id,
      createdById: w.users.receptionist.id,
      branchId: w.branchA.id,
      location: "SERVICE",
    });
    expect(Number(movement.quantity)).toBe(50);
    expect(Number(movement.expectedQuantity)).toBe(50);
    expect(movement.unit).toBe("ML");
    // Service stock is untouched by use from an open bottle: the pack is
    // still there, it just holds less.
    expect(await stockAt(w.shampoo.id, w.branchA.id, "SERVICE")).toBe(5);
    expect(await currentStock(w.shampoo.id)).toBe(100);
  }, LONG);

  it("keeps actual usage separate from the service default", async () => {
    const w = await world();
    await stocked(w);
    const [bottle] = (await openBottle(w, w.token.receptionist)).body.data.containers;
    const appointment = await booking(w, [w.hairWash.id]);
    await complete(w, appointment.id, [
      { appointmentServiceId: appointment.services[0]!.id, productId: w.shampoo.id, quantity: 100, containerId: bottle.id },
    ]).expect(200);
    const movement = await prisma.productStockMovement.findFirstOrThrow({ where: { type: "USED_IN_SERVICE", referenceId: appointment.id } });
    expect(Number(movement.quantity)).toBe(100);
    expect(Number(movement.expectedQuantity)).toBe(50);
    const consumable = await prisma.serviceConsumable.findFirstOrThrow({ where: { serviceId: w.hairWash.id } });
    expect(Number(consumable.quantity)).toBe(50);
  }, LONG);

  it("splits one usage across containers and marks the first one empty", async () => {
    const w = await world();
    await stocked(w);
    const [first] = (await openBottle(w, w.token.receptionist)).body.data.containers;
    // Leave 20 ml in the first bottle.
    await reconcile(w.token.manager, first.id, { actualRemaining: 20, reason: "MEASUREMENT" }).expect(201);
    const [second] = (await openBottle(w, w.token.receptionist)).body.data.containers;
    const appointment = await booking(w, [w.hairWash.id]);
    const line = appointment.services[0]!.id;
    await complete(w, appointment.id, [
      { appointmentServiceId: line, productId: w.shampoo.id, quantity: 20, containerId: first.id },
      { appointmentServiceId: line, productId: w.shampoo.id, quantity: 30, containerId: second.id },
    ]).expect(200);
    const [a, b] = await containers(w.shampoo.id);
    expect([a!.status, Number(a!.remainingQuantity), a!.closedAt instanceof Date]).toEqual(["EMPTY", 0, true]);
    expect([b!.status, Number(b!.remainingQuantity)]).toEqual(["OPEN", 970]);
    const uses = await prisma.productStockMovement.findMany({ where: { referenceId: appointment.id, type: "USED_IN_SERVICE" }, include: { container: true } });
    expect(uses.map((row) => [row.container?.code, Number(row.quantity)]).sort()).toEqual([["SH-001", 20], ["SH-002", 30]]);
  }, LONG);

  it("takes the default from the oldest open bottle and spills into the next", async () => {
    const w = await world();
    await stocked(w);
    const [first] = (await openBottle(w, w.token.receptionist)).body.data.containers;
    await reconcile(w.token.manager, first.id, { actualRemaining: 30, reason: "MEASUREMENT" }).expect(201);
    await openBottle(w, w.token.receptionist).expect(201);
    const appointment = await booking(w, [w.hairWash.id]);
    await complete(w, appointment.id).expect(200);
    const [a, b] = await containers(w.shampoo.id);
    expect(Number(a!.remainingQuantity)).toBe(0);
    expect(Number(b!.remainingQuantity)).toBe(980);
  }, LONG);

  it("refuses usage from empty and lost containers", async () => {
    const w = await world();
    await stocked(w);
    const [emptyBottle] = (await openBottle(w, w.token.receptionist)).body.data.containers;
    const [lostBottle] = (await openBottle(w, w.token.receptionist)).body.data.containers;
    await reconcile(w.token.manager, emptyBottle.id, { actualRemaining: 0, reason: "SPILLAGE" }).expect(201);
    await reconcile(w.token.manager, lostBottle.id, { actualRemaining: 0, reason: "LOST", note: "Not found after shift" }).expect(201);
    expect((await containers(w.shampoo.id)).map((row) => row.status)).toEqual(["EMPTY", "LOST"]);
    for (const bottle of [emptyBottle, lostBottle]) {
      const appointment = await booking(w, [w.hairWash.id]);
      const response = await complete(w, appointment.id, [
        { appointmentServiceId: appointment.services[0]!.id, productId: w.shampoo.id, quantity: 10, containerId: bottle.id },
      ]);
      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/cannot be used/);
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("CHECKED_IN");
    }
    // With nothing open, the default asks for a bottle to be opened.
    const appointment = await booking(w, [w.hairWash.id]);
    const response = await complete(w, appointment.id);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "INSUFFICIENT_OPEN_STOCK" });
    expect(response.body.message).toMatch(/Open a new pack/);
  }, LONG);

  it("uses sealed service stock for products without containers, never the warehouse", async () => {
    const w = await world();
    await purchase(w, w.gloves.id, 20, "WAREHOUSE").expect(201);
    const appointment = await booking(w, [w.manicure.id]);
    const blocked = await complete(w, appointment.id);
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toBe("Insufficient stock for service consumables");
    expect(blocked.body.stock).toMatchObject({ location: "SERVICE", available: 0, needed: 2 });
    expect(await stockAt(w.gloves.id, w.branchA.id, "WAREHOUSE")).toBe(20);

    await transfer(w, w.token.staff, { productId: w.gloves.id, fromLocation: "WAREHOUSE", toLocation: "SERVICE", quantity: 4 }).expect(201);
    await complete(w, appointment.id).expect(200);
    expect(await stockAt(w.gloves.id, w.branchA.id, "SERVICE")).toBe(2);
    expect(await stockAt(w.gloves.id, w.branchA.id, "WAREHOUSE")).toBe(16);
    expect(await currentStock(w.gloves.id)).toBe(18);
  }, LONG);

  it("reverses container usage when a completed appointment is cancelled", async () => {
    const w = await world();
    await stocked(w);
    const [bottle] = (await openBottle(w, w.token.receptionist)).body.data.containers;
    await reconcile(w.token.manager, bottle.id, { actualRemaining: 50, reason: "MEASUREMENT" }).expect(201);
    const appointment = await booking(w, [w.hairWash.id]);
    await complete(w, appointment.id).expect(200);
    expect((await containers(w.shampoo.id))[0]!.status).toBe("EMPTY");
    await request(app).patch(`/api/appointments/${appointment.id}/status`).set(auth(w.token.receptionist)).send({ status: "CANCELLED" }).expect(200);
    await request(app).patch(`/api/appointments/${appointment.id}/status`).set(auth(w.token.receptionist)).send({ status: "CANCELLED" }).expect(400);
    const [after] = await containers(w.shampoo.id);
    expect([after!.status, Number(after!.remainingQuantity), after!.closedAt]).toEqual(["OPEN", 50, null]);
    const returned = await prisma.productStockMovement.findMany({ where: { referenceId: appointment.id, type: "RETURNED" } });
    expect(returned).toHaveLength(1);
    expect(returned[0]).toMatchObject({ containerId: bottle.id, referenceType: "APPOINTMENT_CONSUMABLE_REVERSAL" });
  }, LONG);

  it("returns sealed consumables to the service area on appointment cancellation", async () => {
    const w = await world();
    await purchase(w, w.gloves.id, 10, "SERVICE").expect(201);
    const appointment = await booking(w, [w.manicure.id]);
    await complete(w, appointment.id).expect(200);
    expect(await stockAt(w.gloves.id, w.branchA.id, "SERVICE")).toBe(8);
    await request(app).patch(`/api/appointments/${appointment.id}/status`).set(auth(w.token.receptionist)).send({ status: "CANCELLED" }).expect(200);
    expect(await stockAt(w.gloves.id, w.branchA.id, "SERVICE")).toBe(10);
    expect(await currentStock(w.gloves.id)).toBe(10);
  }, LONG);

  it("keeps exact decimals when usage is fractional", async () => {
    const w = await world();
    await stocked(w);
    const [bottle] = (await openBottle(w, w.token.receptionist)).body.data.containers;
    const appointment = await booking(w, [w.hairWash.id, w.hairSpa.id]);
    await complete(w, appointment.id, [
      { appointmentServiceId: appointment.services[0]!.id, productId: w.shampoo.id, quantity: 0.1, containerId: bottle.id },
      { appointmentServiceId: appointment.services[1]!.id, productId: w.shampoo.id, quantity: 0.2, containerId: bottle.id },
    ]).expect(200);
    const after = await prisma.productContainer.findUniqueOrThrow({ where: { id: bottle.id } });
    // 1000 - 0.1 - 0.2 is 999.6999999999999 in floating point.
    expect(after.remainingQuantity.toString()).toBe("999.7");
    const tooPrecise = await booking(w, [w.hairWash.id]);
    const response = await complete(w, tooPrecise.id, [
      { appointmentServiceId: tooPrecise.services[0]!.id, productId: w.shampoo.id, quantity: 0.125, containerId: bottle.id },
    ]);
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/2 decimal places/);
  }, LONG);

  it("lets only one of two simultaneous services use the last 50 ml", async () => {
    const w = await world();
    await stocked(w);
    const [bottle] = (await openBottle(w, w.token.receptionist)).body.data.containers;
    await reconcile(w.token.manager, bottle.id, { actualRemaining: 50, reason: "MEASUREMENT" }).expect(201);
    const first = await booking(w, [w.hairWash.id]);
    const second = await booking(w, [w.hairWash.id]);
    const results = await Promise.all([complete(w, first.id), complete(w, second.id)]);
    expect(results.map((row) => row.status).sort()).toEqual([200, 400]);
    const after = await prisma.productContainer.findUniqueOrThrow({ where: { id: bottle.id } });
    expect(Number(after.remainingQuantity)).toBe(0);
    expect(await prisma.productStockMovement.count({ where: { containerId: bottle.id, type: "USED_IN_SERVICE" } })).toBe(1);
  }, LONG);

  it("rolls back all usage of a completion when one product is short", async () => {
    const w = await world();
    await stocked(w);
    await purchase(w, w.gloves.id, 1, "SERVICE").expect(201);
    await prisma.serviceConsumable.create({ data: { salonId: w.salon.id, serviceId: w.hairWash.id, productId: w.gloves.id, quantity: 2 } });
    const [bottle] = (await openBottle(w, w.token.receptionist)).body.data.containers;
    const appointment = await booking(w, [w.hairWash.id]);
    const response = await complete(w, appointment.id);
    expect(response.status).toBe(400);
    expect(Number((await prisma.productContainer.findUniqueOrThrow({ where: { id: bottle.id } })).remainingQuantity)).toBe(1000);
    expect(await stockAt(w.gloves.id, w.branchA.id, "SERVICE")).toBe(1);
    expect(await prisma.productStockMovement.count({ where: { referenceId: appointment.id } })).toBe(0);
  }, LONG);

  it("completes services without consumables or inventory as before", async () => {
    const w = await world();
    const appointment = await booking(w, [w.haircut.id]);
    await complete(w, appointment.id).expect(200);
    expect(await prisma.productStockMovement.count({ where: { referenceId: appointment.id } })).toBe(0);
  }, LONG);
});

describe("reconciliation, wastage and loss", () => {
  it("books the gap from a physical check under its reason, not as usage", async () => {
    const w = await world();
    await stocked(w);
    const [bottle] = (await openBottle(w, w.token.receptionist)).body.data.containers;
    const appointment = await booking(w, [w.hairWash.id, w.hairSpa.id]);
    await complete(w, appointment.id, [
      { appointmentServiceId: appointment.services[0]!.id, productId: w.shampoo.id, quantity: 170, containerId: bottle.id },
      { appointmentServiceId: appointment.services[1]!.id, productId: w.shampoo.id, quantity: 80, containerId: bottle.id },
    ]).expect(200);
    // System 750 ml, the bottle holds 650 ml.
    const response = await reconcile(w.token.manager, bottle.id, { actualRemaining: 650, reason: "SPILLAGE", note: "Knocked over" });
    expect(response.status).toBe(201);
    expect(response.body.data.movement).toMatchObject({ type: "WASTAGE", reason: "Spillage", note: "Knocked over", stockBefore: "750", stockAfter: "650" });
    expect(Number(response.body.data.movement.quantity)).toBe(100);

    // A gain is only an adjustment; a gap of zero records nothing.
    await reconcile(w.token.manager, bottle.id, { actualRemaining: 700, reason: "WASTAGE" }).expect(400);
    const gain = await reconcile(w.token.manager, bottle.id, { actualRemaining: 660, reason: "INCORRECT_USAGE" });
    expect(gain.status).toBe(201);
    expect(gain.body.data.movement).toMatchObject({ type: "ADJUSTMENT", quantity: "10" });
    await reconcile(w.token.manager, bottle.id, { actualRemaining: 660, reason: "OTHER" }).expect(400);
    await reconcile(w.token.manager, bottle.id, { actualRemaining: 1200, reason: "OTHER" }).expect(400);

    const damaged = await reconcile(w.token.admin, bottle.id, { actualRemaining: 0, reason: "DAMAGED" });
    expect(damaged.body.data.container).toMatchObject({ status: "DAMAGED" });
    expect(Number(damaged.body.data.movement.quantity)).toBe(660);

    // Remaining is exactly what the movements explain.
    const movements = await prisma.productStockMovement.findMany({ where: { containerId: bottle.id, unit: "ML" } });
    const derived = movements.reduce((left, row) => {
      const adds = row.type === "RETURNED" || (row.type === "ADJUSTMENT" && row.quantity.isPositive());
      return adds ? left.plus(row.quantity.abs()) : left.minus(row.quantity.abs());
    }, new Prisma.Decimal(1000));
    const after = await prisma.productContainer.findUniqueOrThrow({ where: { id: bottle.id } });
    expect(derived.equals(after.remainingQuantity)).toBe(true);
  }, LONG);

  it("records sealed-stock wastage and loss at a location", async () => {
    const w = await world();
    await stocked(w);
    const lost = await request(app).post("/api/stock-movements/manual").set(auth(w.token.admin)).send({ productId: w.shampoo.id, branchId: w.branchA.id, location: "WAREHOUSE", type: "LOST", quantity: 2, reason: "Stock count" });
    expect(lost.status).toBe(201);
    const wasted = await request(app).post("/api/stock-movements/manual").set(auth(w.token.admin)).send({ productId: w.shampoo.id, branchId: w.branchA.id, location: "RETAIL", type: "WASTAGE", quantity: 1, reason: "Leaking" });
    expect(wasted.status).toBe(201);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "WAREHOUSE")).toBe(78);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "RETAIL")).toBe(14);
    expect(await currentStock(w.shampoo.id)).toBe(97);
    await request(app).post("/api/stock-movements/manual").set(auth(w.token.admin)).send({ productId: w.shampoo.id, type: "TRANSFER", quantity: 1 }).expect(400);
  }, LONG);
});

describe("retail stock", () => {
  it("sells from the retail shelf only", async () => {
    const w = await world();
    await stocked(w);
    const sale = await request(app).post("/api/retail-sales").set(auth(w.token.receptionist)).send({ items: [{ productId: w.shampoo.id, quantity: 2, unitPrice: 400 }] });
    expect(sale.status).toBe(201);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "RETAIL")).toBe(13);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "WAREHOUSE")).toBe(80);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "SERVICE")).toBe(5);
    expect(await prisma.productStockMovement.findFirstOrThrow({ where: { productId: w.shampoo.id, type: "RETAIL_SALE" } })).toMatchObject({ location: "RETAIL", branchId: w.branchA.id });

    const tooMany = await request(app).post("/api/retail-sales").set(auth(w.token.receptionist)).send({ items: [{ productId: w.shampoo.id, quantity: 14, unitPrice: 400 }] });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body).toMatchObject({ code: "INSUFFICIENT_STOCK", stock: { location: "RETAIL", available: 13 } });
    expect(await stockAt(w.shampoo.id, w.branchA.id, "WAREHOUSE")).toBe(80);
  }, LONG);

  it("offers the warehouse on an empty job cart shelf and sells after a transfer", async () => {
    const w = await world();
    await purchase(w, w.shampoo.id, 80, "WAREHOUSE").expect(201);
    const cart = await request(app).post("/api/job-carts").set(auth(w.token.receptionist)).send({ branchId: w.branchA.id, customerName: "Walk-in", phone: "98765 11111", startTime: "2038-01-01T10:00:00.000Z", serviceIds: [w.haircut.id] });
    expect(cart.status).toBe(201);
    const id = cart.body.data.id as string;
    const blocked = await request(app).post(`/api/job-carts/${id}/items`).set(auth(w.token.receptionist)).send({ itemType: "PRODUCT", productId: w.shampoo.id, quantity: 1 });
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ code: "INSUFFICIENT_STOCK", stock: { location: "RETAIL", available: 0, needed: 1, warehouse: 80 } });

    await transfer(w, w.token.receptionist, { fromLocation: "WAREHOUSE", toLocation: "RETAIL", quantity: 2, issuedByStaffId: w.amit.id }).expect(201);
    await request(app).post(`/api/job-carts/${id}/items`).set(auth(w.token.receptionist)).send({ itemType: "PRODUCT", productId: w.shampoo.id, quantity: 1 }).expect(200);
    await request(app).post(`/api/job-carts/${id}/confirm`).set(auth(w.token.receptionist)).send({}).expect(200);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "WAREHOUSE")).toBe(78);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "RETAIL")).toBe(1);
    const history = await request(app).get(`/api/stock-movements/product/${w.shampoo.id}`).set(auth(w.token.admin));
    expect(history.body.data.map((row: { type: string }) => row.type)).toEqual(["RETAIL_SALE", "TRANSFER", "STOCK_IN"]);
  }, LONG);

  it("lets Make Bill sell a product after a warehouse transfer", async () => {
    const w = await world();
    await purchase(w, w.shampoo.id, 80, "WAREHOUSE").expect(201);
    const appointment = await booking(w, [w.haircut.id]);
    await complete(w, appointment.id).expect(200);
    const bill = (token: string) =>
      request(app).post(`/api/invoices/from-appointment/${appointment.id}`).set(auth(token)).send({ extraItems: [{ itemType: "PRODUCT", productId: w.shampoo.id, quantity: 1 }] });
    const blocked = await bill(w.token.receptionist);
    expect(blocked.status).toBe(400);
    expect(blocked.body).toMatchObject({ code: "INSUFFICIENT_STOCK", stock: { location: "RETAIL" } });
    expect(await prisma.invoice.count({ where: { appointmentId: appointment.id } })).toBe(0);
    await transfer(w, w.token.receptionist, { fromLocation: "WAREHOUSE", toLocation: "RETAIL", quantity: 2 }).expect(201);
    await bill(w.token.receptionist).expect(201);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "RETAIL")).toBe(1);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "WAREHOUSE")).toBe(78);
  }, LONG);

  it("puts a purchase without a location where the product is used, as before", async () => {
    const w = await world();
    await purchase(w, w.shampoo.id, 10).expect(201);
    await purchase(w, w.gloves.id, 10).expect(201);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "RETAIL")).toBe(10);
    expect(await stockAt(w.gloves.id, w.branchA.id, "SERVICE")).toBe(10);
    await purchase(w, w.shampoo.id, 1, "SHELF").expect(400);
  }, LONG);
});

describe("job cart usage confirmation", () => {
  const cartWithWash = async (w: World) => {
    const cart = await request(app).post("/api/job-carts").set(auth(w.token.receptionist)).send({ branchId: w.branchA.id, customerName: "Walk-in", phone: "98765 22222", startTime: "2038-01-01T12:00:00.000Z", serviceIds: [w.hairWash.id], staffId: w.rahul.id });
    expect(cart.status).toBe(201);
    return cart.body.data.id as string;
  };

  it("books the confirmed quantities with the bill, once", async () => {
    const w = await world();
    await stocked(w);
    const [bottle] = (await openBottle(w, w.token.receptionist)).body.data.containers;
    const id = await cartWithWash(w);
    const plan = await request(app).get(`/api/inventory/usage-plan/${id}`).set(auth(w.token.receptionist));
    expect(plan.status).toBe(200);
    expect(plan.body.data.lines).toHaveLength(1);
    const line = plan.body.data.lines[0];
    expect(line.consumables).toEqual([{ productId: w.shampoo.id, expectedQuantity: "50" }]);
    expect(plan.body.data.products[0]).toMatchObject({ containerTracked: true, unit: "ML", openContainers: [expect.objectContaining({ id: bottle.id, code: "SH-001" })] });

    const body = { usage: [{ appointmentServiceId: line.appointmentServiceId, productId: w.shampoo.id, quantity: 100, containerId: bottle.id }] };
    const [first, second] = await Promise.all([
      request(app).post(`/api/job-carts/${id}/confirm`).set(auth(w.token.receptionist)).send(body),
      request(app).post(`/api/job-carts/${id}/confirm`).set(auth(w.token.receptionist)).send(body),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const confirmed = [first, second].find((row) => row.status === 200)!;
    expect(confirmed.body.data).toMatchObject({ appointmentStatus: "COMPLETED", invoice: { status: "ISSUED" } });
    expect(Number((await prisma.productContainer.findUniqueOrThrow({ where: { id: bottle.id } })).remainingQuantity)).toBe(900);
    expect(await prisma.productStockMovement.count({ where: { referenceId: id, type: "USED_IN_SERVICE" } })).toBe(1);
  }, LONG);

  it("rolls the usage back when the bill cannot be confirmed", async () => {
    const w = await world();
    await stocked(w);
    const [bottle] = (await openBottle(w, w.token.receptionist)).body.data.containers;
    const id = await cartWithWash(w);
    const lineId = (await prisma.appointmentService.findFirstOrThrow({ where: { appointmentId: id } })).id;
    const response = await request(app).post(`/api/job-carts/${id}/confirm`).set(auth(w.token.receptionist)).send({
      usage: [{ appointmentServiceId: lineId, productId: w.shampoo.id, quantity: 60, containerId: bottle.id }],
      payments: [{ method: "CASH", amount: 99999 }],
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(Number((await prisma.productContainer.findUniqueOrThrow({ where: { id: bottle.id } })).remainingQuantity)).toBe(1000);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id } })).status).toBe("SCHEDULED");
  }, LONG);

  it("rejects usage for a product the service does not use", async () => {
    const w = await world();
    await stocked(w);
    const id = await cartWithWash(w);
    const lineId = (await prisma.appointmentService.findFirstOrThrow({ where: { appointmentId: id } })).id;
    const response = await request(app).post(`/api/job-carts/${id}/confirm`).set(auth(w.token.receptionist)).send({ usage: [{ appointmentServiceId: lineId, productId: w.gloves.id, quantity: 1 }] });
    expect(response.status).toBe(400);
  }, LONG);

  it("leaves an active job cart cancellation free of stock movements", async () => {
    const w = await world();
    await stocked(w);
    const id = await cartWithWash(w);
    await request(app).post(`/api/job-carts/${id}/cancel`).set(auth(w.token.receptionist)).expect(200);
    expect(await prisma.productStockMovement.count({ where: { referenceId: id } })).toBe(0);
  }, LONG);
});

describe("access rules", () => {
  it("confines branch roles to their branch and staff to the service area", async () => {
    const w = await world();
    await stocked(w);
    const [bottle] = (await openBottle(w, w.token.staff)).body.data.containers;
    expect(bottle.branchId).toBe(w.branchA.id);
    await transfer(w, w.token.staff, { fromLocation: "WAREHOUSE", toLocation: "SERVICE", quantity: 1 }).expect(201);
    await transfer(w, w.token.staff, { fromLocation: "WAREHOUSE", toLocation: "RETAIL", quantity: 1 }).expect(403);
    await reconcile(w.token.receptionist, bottle.id, { actualRemaining: 900, reason: "WASTAGE" }).expect(403);
    await reconcile(w.token.staff, bottle.id, { actualRemaining: 900, reason: "WASTAGE" }).expect(403);
    await reconcile(w.token.managerB, bottle.id, { actualRemaining: 900, reason: "WASTAGE" }).expect(404);
    await reconcile(w.token.manager, bottle.id, { actualRemaining: 900, reason: "WASTAGE" }).expect(201);
    // Branch B sees salon-level and its own stock, not branch A's.
    const view = await request(app).get(`/api/inventory/products/${w.shampoo.id}`).set(auth(w.token.receptionistB));
    expect(view.status).toBe(200);
    expect(view.body.data.sites.map((site: { branchId: string | null }) => site.branchId)).not.toContain(w.branchA.id);
    expect(view.body.data.containers).toHaveLength(0);
    // Branch B staff cannot be named on branch A stock.
    await transfer(w, w.token.receptionist, { fromLocation: "WAREHOUSE", toLocation: "RETAIL", quantity: 1, issuedByStaffId: w.bina.id }).expect(404);
  }, LONG);

  it("keeps every inventory endpoint inside the salon", async () => {
    const w = await world();
    await stocked(w);
    const [bottle] = (await openBottle(w, w.token.receptionist)).body.data.containers;
    const appointment = await booking(w, [w.hairWash.id]);
    await request(app).get(`/api/inventory/products/${w.shampoo.id}`).set(auth(w.token.otherAdmin)).expect(404);
    await transfer(w, w.token.otherAdmin, { fromLocation: "WAREHOUSE", toLocation: "RETAIL", quantity: 1 }).expect(404);
    await openBottle(w, w.token.otherAdmin).expect(404);
    await reconcile(w.token.otherAdmin, bottle.id, { actualRemaining: 1, reason: "OTHER" }).expect(404);
    await request(app).get(`/api/inventory/usage-plan/${appointment.id}`).set(auth(w.token.otherAdmin)).expect(404);
    await request(app).get(`/api/inventory/usage-plan/${appointment.id}`).set(auth(w.token.receptionistB)).expect(404);
  }, LONG);

  it("answers bad requests with the usual error shape", async () => {
    const w = await world();
    await stocked(w);
    const expectFail = async (response: request.Response, status: number) => {
      expect(response.status).toBe(status);
      expect(response.body.success).toBe(false);
      expect(typeof response.body.message).toBe("string");
    };
    await expectFail(await transfer(w, w.token.admin, { productId: randomUUID(), fromLocation: "WAREHOUSE", toLocation: "RETAIL", quantity: 1 }), 404);
    await expectFail(await transfer(w, w.token.admin, { fromLocation: "ATTIC", toLocation: "RETAIL", quantity: 1 }), 400);
    for (const quantity of [0, -1, "abc"]) {
      await expectFail(await transfer(w, w.token.admin, { branchId: w.branchA.id, fromLocation: "WAREHOUSE", toLocation: "RETAIL", quantity }), 400);
    }
    await expectFail(await transfer(w, w.token.admin, { branchId: w.branchA.id, fromLocation: "RETAIL", toLocation: "RETAIL", quantity: 1 }), 400);
    await expectFail(await transfer(w, w.token.admin, { branchId: w.branchA.id, fromLocation: "WAREHOUSE", toLocation: "RETAIL", quantity: 1, issuedByStaffId: randomUUID() }), 404);
    await expectFail(await openBottle(w, w.token.receptionist, { productId: w.gloves.id }), 400);
    await expectFail(await openBottle(w, w.token.receptionist, { count: 99 }), 400);
    await expectFail(await reconcile(w.token.admin, randomUUID(), { actualRemaining: 1, reason: "OTHER" }), 404);
    await expectFail(await reconcile(w.token.admin, randomUUID(), { actualRemaining: 1, reason: "GUESS" }), 400);
    await expectFail(await request(app).get("/api/inventory/products/not-a-uuid").set(auth(w.token.admin)), 400);
    // A drained service area cannot open another pack.
    await openBottle(w, w.token.receptionist, { count: 5 }).expect(201);
    const drained = await openBottle(w, w.token.receptionist);
    await expectFail(drained, 400);
    expect(drained.body.code).toBe("INSUFFICIENT_STOCK");
  }, LONG);

  it("opens a pack once for a repeated request", async () => {
    const w = await world();
    await stocked(w);
    const requestId = randomUUID();
    const [first, second] = await Promise.all([openBottle(w, w.token.receptionist, { requestId }), openBottle(w, w.token.receptionist, { requestId })]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(await prisma.productContainer.count({ where: { productId: w.shampoo.id } })).toBe(1);
    expect(await stockAt(w.shampoo.id, w.branchA.id, "SERVICE")).toBe(5);
    const [bottle] = first.body.data.containers;
    const again = randomUUID();
    await reconcile(w.token.manager, bottle.id, { actualRemaining: 900, reason: "SPILLAGE", requestId: again }).expect(201);
    await reconcile(w.token.manager, bottle.id, { actualRemaining: 900, reason: "SPILLAGE", requestId: again }).expect(200);
    expect(await prisma.productStockMovement.count({ where: { containerId: bottle.id, type: "WASTAGE" } })).toBe(1);
  }, LONG);
});

describe("audit trail and insights", () => {
  it("audits every kind of inventory movement with who, what, where and how much", async () => {
    const w = await world();
    await stocked(w);
    const [bottle] = (await openBottle(w, w.token.receptionist)).body.data.containers;
    const appointment = await booking(w, [w.hairWash.id]);
    await complete(w, appointment.id).expect(200);
    await request(app).post("/api/retail-sales").set(auth(w.token.receptionist)).send({ items: [{ productId: w.shampoo.id, quantity: 1, unitPrice: 400 }] }).expect(201);
    await reconcile(w.token.manager, bottle.id, { actualRemaining: 900, reason: "WASTAGE" }).expect(201);
    await reconcile(w.token.manager, bottle.id, { actualRemaining: 910, reason: "MEASUREMENT" }).expect(201);
    await reconcile(w.token.manager, bottle.id, { actualRemaining: 0, reason: "LOST" }).expect(201);

    const movements = await prisma.productStockMovement.findMany({ where: { productId: w.shampoo.id } });
    const types = new Set(movements.map((row) => row.type));
    for (const type of ["STOCK_IN", "TRANSFER", "OPEN_CONTAINER", "USED_IN_SERVICE", "RETAIL_SALE", "WASTAGE", "ADJUSTMENT", "LOST"]) {
      expect(types.has(type as never)).toBe(true);
    }
    for (const movement of movements) {
      const log = await prisma.auditLog.findFirst({ where: { entityId: movement.id, module: "INVENTORY", action: "STOCK_MOVEMENT" } });
      expect(log).not.toBeNull();
      expect(log!.userId).toBe(movement.createdById);
      expect(log!.userName).toBeTruthy();
      expect(log!.branchId).toBe(w.branchA.id);
      expect(log!.newData).toMatchObject({ type: movement.type });
      expect(movement.createdAt).toBeInstanceOf(Date);
    }
    const use = movements.find((row) => row.type === "USED_IN_SERVICE")!;
    expect(use).toMatchObject({ referenceId: appointment.id, staffId: w.rahul.id, serviceId: w.hairWash.id, containerId: bottle.id });
  }, LONG);

  it("tracks a bottle through five services and wastage, and reports them apart", async () => {
    const w = await world();
    await stocked(w);
    const [bottle] = (await openBottle(w, w.token.receptionist)).body.data.containers;
    const amounts = [50, 50, 50, 50, 100];
    const appointments = [];
    for (const amount of amounts) {
      const appointment = await booking(w, [w.hairWash.id]);
      await complete(w, appointment.id, [
        { appointmentServiceId: appointment.services[0]!.id, productId: w.shampoo.id, quantity: amount, containerId: bottle.id },
      ]).expect(200);
      appointments.push(appointment.id);
    }
    expect(Number((await prisma.productContainer.findUniqueOrThrow({ where: { id: bottle.id } })).remainingQuantity)).toBe(700);
    const uses = await prisma.productStockMovement.findMany({ where: { containerId: bottle.id, type: "USED_IN_SERVICE" } });
    expect(uses.map((row) => row.referenceId).sort()).toEqual([...appointments].sort());
    expect(uses.reduce((sum, row) => sum + Number(row.quantity), 0)).toBe(300);

    await reconcile(w.token.manager, bottle.id, { actualRemaining: 600, reason: "WASTAGE" }).expect(201);
    // A cancelled appointment no longer counts as usage.
    const extra = await booking(w, [w.hairSpa.id]);
    await complete(w, extra.id).expect(200);
    await request(app).patch(`/api/appointments/${extra.id}/status`).set(auth(w.token.receptionist)).send({ status: "CANCELLED" }).expect(200);

    const view = await request(app).get(`/api/inventory/products/${w.shampoo.id}`).set(auth(w.token.manager));
    expect(view.status).toBe(200);
    const data = view.body.data;
    expect(data.product).toMatchObject({ containerTracked: true, usageUnit: "ML" });
    const site = data.sites.find((row: { branchId: string | null }) => row.branchId === w.branchA.id);
    expect(site).toMatchObject({ WAREHOUSE: "80", RETAIL: "15", SERVICE: "5", sealedService: "4", openContainers: 1, openRemaining: "600" });
    expect(data.usage).toMatchObject({ today: "300", week: "300", month: "300", total: "300" });
    expect(data.discrepancies).toMatchObject({ serviceUsage: "300", wastage: "100", lost: "0" });
    const wash = data.usageByService.find((row: { serviceId: string }) => row.serviceId === w.hairWash.id);
    expect(wash).toMatchObject({ used: "300", lines: 5, averageExpected: "50", averageActual: "60" });
    expect(data.usageByService.some((row: { serviceId: string }) => row.serviceId === w.hairSpa.id)).toBe(false);
    expect(data.containers[0]).toMatchObject({ code: "SH-001", openedByStaff: { name: "Rahul" } });
  }, LONG);
});

describe("existing data after the location change", () => {
  it("books stock that was set directly on a product where the migration would", async () => {
    const w = await world();
    const legacyRetail = await prisma.product.create({ data: { name: `Legacy Retail ${randomUUID()}`, salonId: w.salon.id, branchId: w.branchA.id, currentStock: 7, isRetailProduct: true } });
    const legacyService = await prisma.product.create({ data: { name: `Legacy Service ${randomUUID()}`, salonId: w.salon.id, branchId: w.branchA.id, currentStock: 9, isServiceConsumable: true } });
    await request(app).post("/api/retail-sales").set(auth(w.token.receptionist)).send({ items: [{ productId: legacyRetail.id, quantity: 2, unitPrice: 10 }] }).expect(201);
    expect(await stockAt(legacyRetail.id, w.branchA.id, "RETAIL")).toBe(5);
    await prisma.serviceConsumable.create({ data: { salonId: w.salon.id, serviceId: w.haircut.id, productId: legacyService.id, quantity: 1 } });
    const appointment = await booking(w, [w.haircut.id]);
    await complete(w, appointment.id).expect(200);
    expect(await stockAt(legacyService.id, w.branchA.id, "SERVICE")).toBe(8);
  }, LONG);

  it("still lists movements recorded before locations existed", async () => {
    const w = await world();
    const product = await prisma.product.create({ data: { name: `Old ${randomUUID()}`, salonId: w.salon.id, branchId: w.branchA.id, currentStock: 3, isRetailProduct: true } });
    await prisma.productStockMovement.create({ data: { salonId: w.salon.id, branchId: w.branchA.id, productId: product.id, type: "STOCK_IN", quantity: 3, stockBefore: 0, stockAfter: 3, referenceType: "PRODUCT_PURCHASE", referenceId: randomUUID() } });
    const history = await request(app).get(`/api/stock-movements/product/${product.id}`).set(auth(w.token.admin));
    expect(history.status).toBe(200);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0]).toMatchObject({ type: "STOCK_IN", location: null });
    const view = await request(app).get(`/api/inventory/products/${product.id}`).set(auth(w.token.admin));
    expect(view.body.data.sites).toEqual([expect.objectContaining({ branchId: w.branchA.id, RETAIL: "3" })]);
  }, LONG);
});
