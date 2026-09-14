import request from "supertest";

import { app } from "../app.js";
import { prisma } from "../config/prisma.js";
import { hashPass } from "../utils/password.js";
import { generateAccessToken } from "../utils/jwt.js";

// A salon admin can open a session on one branch by sending X-Branch-Id. These
// cover the three things that has to hold: reads narrow to that branch, writes
// land in it, and a branch outside the admin's salon is refused.

const auth = (token: string, branchId?: string) => ({
  Authorization: `Bearer ${token}`,
  ...(branchId ? { "X-Branch-Id": branchId } : {}),
});

const expectSuccess = (res: request.Response, status: number) => {
  if (res.status !== status) {
    throw new Error(
      `Expected ${status}, received ${res.status}: ${JSON.stringify(res.body)}`
    );
  }
  expect(res.body.success).toBe(true);
};

const buildFixture = async () => {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const [salon, foreignSalon] = await Promise.all([
    prisma.salon.create({ data: { name: `Session Salon ${stamp}` } }),
    prisma.salon.create({ data: { name: `Foreign Salon ${stamp}` } }),
  ]);

  const [homeBranch, otherBranch, foreignBranch] = await Promise.all([
    prisma.branch.create({
      data: { name: `Home Branch ${stamp}`, salonId: salon.id },
    }),
    prisma.branch.create({
      data: { name: `Other Branch ${stamp}`, salonId: salon.id },
    }),
    prisma.branch.create({
      data: { name: `Foreign Branch ${stamp}`, salonId: foreignSalon.id },
    }),
  ]);

  const salonAdmin = await prisma.user.create({
    data: {
      name: "Session Salon Admin",
      email: `session-admin-${stamp}@example.com`,
      passwordHash: await hashPass("Password@123"),
      role: "SALON_ADMIN",
      salonId: salon.id,
      branchId: homeBranch.id,
    },
  });

  const staffRow = (name: string, branchId: string, prefix: string) => ({
    name,
    email: `${prefix}-${stamp}@example.com`,
    phone: `${prefix.slice(0, 2)}${stamp.slice(-8)}`,
    jobRole: "Stylist",
    workingFrom: "10:00",
    workingTo: "19:00",
    weekOff: "MONDAY",
    salonId: salon.id,
    branchId,
  });

  const [homeStaff, otherStaff] = await Promise.all([
    prisma.staff.create({ data: staffRow("Home Staff", homeBranch.id, "94") }),
    prisma.staff.create({ data: staffRow("Other Staff", otherBranch.id, "93") }),
  ]);

  // One row per branch in each module that keeps its own branch filter, plus a
  // salon-wide product, which must stay visible inside a branch session.
  const [homeCustomer, otherCustomer] = await Promise.all([
    prisma.customer.create({
      data: {
        name: "Home Customer",
        phone: `81${stamp.slice(-8)}`,
        customerCode: `SESH-1-${stamp}`,
        salonId: salon.id,
        branchId: homeBranch.id,
      },
    }),
    prisma.customer.create({
      data: {
        name: "Other Customer",
        phone: `82${stamp.slice(-8)}`,
        customerCode: `SESH-2-${stamp}`,
        salonId: salon.id,
        branchId: otherBranch.id,
      },
    }),
  ]);

  const product = (name: string, branchId: string | null) => ({
    name,
    salonId: salon.id,
    ...(branchId ? { branchId } : {}),
    unit: "PCS" as const,
    costPrice: 100,
    sellingPrice: 150,
  });

  const [homeProduct, otherProduct, sharedProduct] = await Promise.all([
    prisma.product.create({ data: product(`Home Product ${stamp}`, homeBranch.id) }),
    prisma.product.create({ data: product(`Other Product ${stamp}`, otherBranch.id) }),
    prisma.product.create({ data: product(`Shared Product ${stamp}`, null) }),
  ]);

  const expense = (title: string, branchId: string) => ({
    salonId: salon.id,
    branchId,
    title,
    category: "MISC" as const,
    amount: 500,
    expenseDate: new Date(),
  });

  const [homeExpense, otherExpense] = await Promise.all([
    prisma.expense.create({ data: expense("Home Expense", homeBranch.id) }),
    prisma.expense.create({ data: expense("Other Expense", otherBranch.id) }),
  ]);

  return {
    homeCustomer,
    otherCustomer,
    homeProduct,
    otherProduct,
    sharedProduct,
    homeExpense,
    otherExpense,
    stamp,
    salon,
    homeBranch,
    otherBranch,
    foreignBranch,
    homeStaff,
    otherStaff,
    adminToken: generateAccessToken({
      userId: salonAdmin.id,
      role: salonAdmin.role,
      salonId: salon.id,
      branchId: homeBranch.id,
    }),
  };
};

describe("Admin branch session", () => {
  it("shows every branch when no branch session is open", async () => {
    const f = await buildFixture();

    const list = await request(app).get("/api/staff").set(auth(f.adminToken));
    expectSuccess(list, 200);

    const ids = (list.body.data as Array<{ id: string }>).map((row) => row.id);
    expect(ids).toEqual(
      expect.arrayContaining([f.homeStaff.id, f.otherStaff.id])
    );
  });

  it("narrows reads to the branch the admin logged into", async () => {
    const f = await buildFixture();

    const list = await request(app)
      .get("/api/staff")
      .set(auth(f.adminToken, f.otherBranch.id));
    expectSuccess(list, 200);

    const ids = (list.body.data as Array<{ id: string }>).map((row) => row.id);
    expect(ids).toContain(f.otherStaff.id);
    expect(ids).not.toContain(f.homeStaff.id);
  });

  it("writes into the branch session even when the body names another", async () => {
    const f = await buildFixture();

    const created = await request(app)
      .post("/api/staff")
      .set(auth(f.adminToken, f.otherBranch.id))
      .send({
        name: `Session Staff ${f.stamp}`,
        email: `session-staff-${f.stamp}@example.com`,
        phone: `92${f.stamp.slice(-8)}`,
        jobRole: "Stylist",
        workingFrom: "10:00",
        workingTo: "19:00",
        weekOff: "MONDAY",
        baseSalary: 20000,
        workingDaysPerMonth: 26,
        branchId: f.homeBranch.id,
      });

    expectSuccess(created, 201);
    expect(created.body.data.branchId).toBe(f.otherBranch.id);
  });

  it("reports the open branch session on /api/auth/me", async () => {
    const f = await buildFixture();

    const me = await request(app)
      .get("/api/auth/me")
      .set(auth(f.adminToken, f.otherBranch.id));
    expectSuccess(me, 200);

    expect(me.body.activeBranch?.id).toBe(f.otherBranch.id);
    expect(me.body.branch?.id).toBe(f.homeBranch.id);
  });

  it("narrows customers, products and expenses to the branch session", async () => {
    const f = await buildFixture();
    const headers = auth(f.adminToken, f.otherBranch.id);

    const [customers, products, expenses] = await Promise.all([
      request(app).get("/api/customers").set(headers),
      request(app).get("/api/products").set(headers),
      request(app).get("/api/expenses").set(headers),
    ]);

    expectSuccess(customers, 200);
    expectSuccess(products, 200);
    expectSuccess(expenses, 200);

    const ids = (res: request.Response) =>
      ((res.body.data as Array<{ id: string }>) ?? []).map((row) => row.id);

    expect(ids(customers)).toContain(f.otherCustomer.id);
    expect(ids(customers)).not.toContain(f.homeCustomer.id);

    expect(ids(products)).toContain(f.otherProduct.id);
    expect(ids(products)).not.toContain(f.homeProduct.id);
    // Salon-wide rows are shared config, not another branch's data.
    expect(ids(products)).toContain(f.sharedProduct.id);

    expect(ids(expenses)).toContain(f.otherExpense.id);
    expect(ids(expenses)).not.toContain(f.homeExpense.id);
  });

  it("ignores a stale branch filter from a page instead of failing", async () => {
    const f = await buildFixture();

    const list = await request(app)
      .get("/api/customers")
      .query({ branchId: f.homeBranch.id })
      .set(auth(f.adminToken, f.otherBranch.id));

    expectSuccess(list, 200);
    const ids = (list.body.data as Array<{ id: string }>).map((row) => row.id);
    expect(ids).toContain(f.otherCustomer.id);
    expect(ids).not.toContain(f.homeCustomer.id);
  });

  it("cannot move a row out of the branch session", async () => {
    const f = await buildFixture();

    const moved = await request(app)
      .put(`/api/customers/${f.otherCustomer.id}`)
      .set(auth(f.adminToken, f.otherBranch.id))
      .send({ name: "Renamed Customer", branchId: f.homeBranch.id });

    expectSuccess(moved, 200);
    const after = await prisma.customer.findUniqueOrThrow({
      where: { id: f.otherCustomer.id },
    });
    expect(after.name).toBe("Renamed Customer");
    expect(after.branchId).toBe(f.otherBranch.id);
  });

  it("refuses a branch outside the admin's salon", async () => {
    const f = await buildFixture();

    const list = await request(app)
      .get("/api/staff")
      .set(auth(f.adminToken, f.foreignBranch.id));

    expect(list.status).toBe(403);
    expect(list.body.success).toBe(false);
  });
});
