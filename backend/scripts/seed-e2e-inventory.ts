/**
 * Builds a throwaway database for the browser tests in frontend/e2e.
 *
 *   DATABASE_URL=postgresql://.../salon_e2e E2E_FIXTURE=/tmp/e2e.json \
 *     npx tsx scripts/seed-e2e-inventory.ts
 *
 * Drops and recreates the database named in DATABASE_URL (its name must
 * contain "e2e"), applies every migration, then seeds one salon through the
 * real stock services and writes the ids the tests need to E2E_FIXTURE.
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL ?? "");
const database = url.pathname.slice(1);
if (!/e2e/i.test(database)) {
  throw new Error(`Refusing to reset "${database}": the database name must contain "e2e"`);
}
const server = new URL(url);
server.pathname = "/postgres";
server.search = "";
const admin = new pg.Client({ connectionString: server.toString() });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
await admin.query(`CREATE DATABASE "${database}"`);
await admin.end();
execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

const { prisma } = await import("../src/config/prisma.js");
const { hashPass } = await import("../src/utils/password.js");
const { createReceivedProductPurchase } = await import(
  "../src/features/product-purchases/product-purchase.service.js"
);
const { transferStock } = await import("../src/features/stock/stockMovement.service.js");

const PASSWORD = "Passcode@123";
const passwordHash = await hashPass(PASSWORD);
const salon = await prisma.salon.create({ data: { name: "E2E Salon" } });
const branch = await prisma.branch.create({ data: { name: "Main", salonId: salon.id } });
const secondBranch = await prisma.branch.create({ data: { name: "Second", salonId: salon.id } });
const [adminUser, receptionist, secondReceptionist] = await Promise.all([
  prisma.user.create({
    data: { name: "E2E Admin", email: "admin@e2e.test", passwordHash, role: "SALON_ADMIN", salonId: salon.id },
  }),
  prisma.user.create({
    data: {
      name: "E2E Reception",
      email: "reception@e2e.test",
      passwordHash,
      role: "RECEPTIONIST",
      salonId: salon.id,
      branchId: branch.id,
    },
  }),
  prisma.user.create({
    data: {
      name: "E2E Second Reception",
      email: "reception2@e2e.test",
      passwordHash,
      role: "RECEPTIONIST",
      salonId: salon.id,
      branchId: secondBranch.id,
    },
  }),
]);
const staff = (name: string) =>
  prisma.staff.create({
    data: {
      name,
      email: `${name.toLowerCase()}@e2e.test`,
      jobRole: "Stylist",
      workingFrom: "00:00",
      workingTo: "23:59",
      weekOff: "NEVER",
      salonId: salon.id,
      branchId: branch.id,
    },
  });
const [rahul, amit] = [await staff("Rahul"), await staff("Amit")];
const customer = await prisma.customer.create({
  data: { customerCode: "E2E-C1", name: "Asha Rao", phone: "9990000001", salonId: salon.id, branchId: branch.id },
});
const washCustomer = await prisma.customer.create({
  data: { customerCode: "E2E-C2", name: "Meera Iyer", phone: "9990000002", salonId: salon.id, branchId: branch.id },
});
const plainCustomer = await prisma.customer.create({
  data: { customerCode: "E2E-C3", name: "Priya Nair", phone: "9990000003", salonId: salon.id, branchId: branch.id },
});
const cancelCustomer = await prisma.customer.create({
  data: { customerCode: "E2E-C4", name: "Devi Menon", phone: "9990000004", salonId: salon.id, branchId: branch.id },
});
const category = await prisma.mainService.create({ data: { name: "Hair", salonId: salon.id } });
const service = (name: string, price: number) =>
  prisma.service.create({
    data: { name, price, durationValue: 30, durationUnit: "MINUTES", salonId: salon.id, branchId: branch.id, mainServiceId: category.id },
  });
const [hairWash, haircut] = [await service("Hair Wash", 300), await service("Haircut", 500)];
const product = (name: string, data: Record<string, unknown>) =>
  prisma.product.create({
    data: { name, salonId: salon.id, branchId: branch.id, sellingPrice: 400, costPrice: 200, category: "Hair Care", ...data },
  });
const shampoo = await product("Shampoo", {
  unit: "BOTTLE",
  packSize: 1000,
  packUnit: "ML",
  isRetailProduct: true,
  isServiceConsumable: true,
});
const serum = await product("Hair Serum", { unit: "PCS", isRetailProduct: true });
const wax = await product("Hair Wax", { unit: "PCS", isRetailProduct: true });
await prisma.serviceConsumable.create({
  data: { salonId: salon.id, serviceId: hairWash.id, productId: shampoo.id, quantity: 50 },
});

// Purchase 100 shampoo into the warehouse, then 15 to retail and 5 to the
// service area; serum on the shelf, wax only in the warehouse.
await prisma.$transaction(async (tx) => {
  await createReceivedProductPurchase({
    tx,
    salonId: salon.id,
    branchId: branch.id,
    location: "WAREHOUSE",
    createdById: adminUser.id,
    items: [
      { productId: shampoo.id, quantity: 100, unitCost: 200 },
      { productId: serum.id, quantity: 20, unitCost: 200 },
      { productId: wax.id, quantity: 80, unitCost: 200 },
    ],
  });
  const move = (productId: string, toLocation: "RETAIL" | "SERVICE", quantity: number) =>
    transferStock({
      tx,
      salonId: salon.id,
      productId,
      quantity,
      fromBranchId: branch.id,
      fromLocation: "WAREHOUSE",
      toBranchId: branch.id,
      toLocation,
      createdById: adminUser.id,
    });
  await move(shampoo.id, "RETAIL", 15);
  await move(shampoo.id, "SERVICE", 5);
  await move(serum.id, "RETAIL", 5);
});

// Today, so the appointment calendar opens on it.
const start = new Date();
start.setHours(9, 0, 0, 0);
const appointment = (
  code: string,
  serviceRow: { id: string; name: string; price: unknown },
  hour: number,
  customerId = customer.id
) =>
  prisma.appointment.create({
    data: {
      appointmentCode: code,
      salonId: salon.id,
      branchId: branch.id,
      customerId,
      staffId: rahul.id,
      startTime: new Date(start.getTime() + hour * 3_600_000),
      endTime: new Date(start.getTime() + hour * 3_600_000 + 1_800_000),
      status: "CHECKED_IN",
      services: {
        create: { serviceId: serviceRow.id, serviceName: serviceRow.name, price: serviceRow.price as number, staffId: rahul.id },
      },
    },
  });
const washAppointment = await appointment("E2E-APT-WASH", hairWash, 1, washCustomer.id);
const plainAppointment = await appointment("E2E-APT-PLAIN", haircut, 4, plainCustomer.id);
const cancelAppointment = await appointment("E2E-APT-CANCEL", hairWash, 5, cancelCustomer.id);
const billAppointment = await appointment("E2E-APT-BILL", haircut, 2);
const transferAppointment = await appointment("E2E-APT-BILL-2", haircut, 3);

const fixture = {
  password: PASSWORD,
  adminEmail: adminUser.email,
  receptionEmail: receptionist.email,
  salonId: salon.id,
  branchId: branch.id,
  secondBranchId: secondBranch.id,
  secondReceptionEmail: secondReceptionist.email,
  staff: { rahul: rahul.id, amit: amit.id },
  customer: { id: customer.id, name: customer.name, phone: customer.phone },
  washCustomer: washCustomer.name,
  plainCustomer: plainCustomer.name,
  cancelCustomer: cancelCustomer.name,
  services: { hairWash: hairWash.id, haircut: haircut.id },
  products: { shampoo: shampoo.id, serum: serum.id, wax: wax.id },
  appointments: {
    wash: washAppointment.id,
    plain: plainAppointment.id,
    cancel: cancelAppointment.id,
    bill: billAppointment.id,
    transfer: transferAppointment.id,
  },
};
writeFileSync(process.env.E2E_FIXTURE ?? "e2e-fixture.json", JSON.stringify(fixture, null, 2));
await prisma.$disconnect();
console.log(`Seeded ${database}`);
