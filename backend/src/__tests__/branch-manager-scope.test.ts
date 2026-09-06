import request from "supertest";

import { app } from "../app.js";
import { prisma } from "../config/prisma.js";
import { hashPass } from "../utils/password.js";
import { generateAccessToken } from "../utils/jwt.js";

const auth = (token: string) => ({
  Authorization: `Bearer ${token}`,
});

const expectSuccess = (res: request.Response, status: number) => {
  if (res.status !== status) {
    throw new Error(
      `Expected ${status}, received ${res.status}: ${JSON.stringify(res.body)}`
    );
  }

  expect(res.body.success).toBe(true);
};

const expectFailure = (res: request.Response, status: number) => {
  if (res.status !== status) {
    throw new Error(
      `Expected ${status}, received ${res.status}: ${JSON.stringify(res.body)}`
    );
  }

  expect(res.body.success).toBe(false);
};

const buildFixture = async () => {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const salon = await prisma.salon.create({
    data: { name: `Branch Scope Salon ${stamp}` },
  });

  const [homeBranch, otherBranch] = await Promise.all([
    prisma.branch.create({
      data: { name: `Home Branch ${stamp}`, salonId: salon.id },
    }),
    prisma.branch.create({
      data: { name: `Other Branch ${stamp}`, salonId: salon.id },
    }),
  ]);

  const manager = await prisma.user.create({
    data: {
      name: "Scope Manager",
      email: `scope-manager-${stamp}@example.com`,
      passwordHash: await hashPass("Password@123"),
      role: "BRANCH_MANAGER",
      salonId: salon.id,
      branchId: homeBranch.id,
    },
  });

  const salonAdmin = await prisma.user.create({
    data: {
      name: "Scope Salon Admin",
      email: `scope-admin-${stamp}@example.com`,
      passwordHash: await hashPass("Password@123"),
      role: "SALON_ADMIN",
      salonId: salon.id,
      branchId: homeBranch.id,
    },
  });

  return {
    stamp,
    salon,
    homeBranch,
    otherBranch,
    manager,
    salonAdmin,
    managerToken: generateAccessToken({
      userId: manager.id,
      role: manager.role,
      salonId: salon.id,
      branchId: homeBranch.id,
    }),
    adminToken: generateAccessToken({
      userId: salonAdmin.id,
      role: salonAdmin.role,
      salonId: salon.id,
      branchId: homeBranch.id,
    }),
  };
};

const staffPayload = (stamp: string, overrides: Record<string, unknown> = {}) => ({
  name: `Scope Staff ${stamp}`,
  email: `scope-staff-${stamp}@example.com`,
  phone: `98${stamp.slice(-8)}`,
  jobRole: "Stylist",
  workingFrom: "10:00",
  workingTo: "19:00",
  weekOff: "MONDAY",
  baseSalary: 20000,
  workingDaysPerMonth: 26,
  ...overrides,
});

describe("Branch manager scope", () => {
  it("assigns the manager's own branch to staff they create", async () => {
    const f = await buildFixture();

    const created = await request(app)
      .post("/api/staff")
      .set(auth(f.managerToken))
      .send(staffPayload(f.stamp));

    expectSuccess(created, 201);
    expect(created.body.data.branchId).toBe(f.homeBranch.id);
  });

  it("ignores a branchId the manager supplies for another branch", async () => {
    const f = await buildFixture();

    const created = await request(app)
      .post("/api/staff")
      .set(auth(f.managerToken))
      .send(staffPayload(f.stamp, { branchId: f.otherBranch.id }));

    expectSuccess(created, 201);
    expect(created.body.data.branchId).toBe(f.homeBranch.id);
  });

  it("lets a salon admin choose any branch in their salon", async () => {
    const f = await buildFixture();

    const created = await request(app)
      .post("/api/staff")
      .set(auth(f.adminToken))
      .send(staffPayload(f.stamp, { branchId: f.otherBranch.id }));

    expectSuccess(created, 201);
    expect(created.body.data.branchId).toBe(f.otherBranch.id);
  });

  it("hides staff from other branches and blocks writes against them", async () => {
    const f = await buildFixture();

    const outsider = await prisma.staff.create({
      data: {
        name: "Outsider Staff",
        email: `outsider-${f.stamp}@example.com`,
        phone: `97${f.stamp.slice(-8)}`,
        jobRole: "Stylist",
        workingFrom: "10:00",
        workingTo: "19:00",
        weekOff: "MONDAY",
        salonId: f.salon.id,
        branchId: f.otherBranch.id,
      },
    });

    const list = await request(app).get("/api/staff").set(auth(f.managerToken));
    expectSuccess(list, 200);
    expect(
      (list.body.data as Array<{ id: string }>).some(
        (staff) => staff.id === outsider.id
      )
    ).toBe(false);

    expectFailure(
      await request(app)
        .get(`/api/staff/${outsider.id}`)
        .set(auth(f.managerToken)),
      404
    );

    expectFailure(
      await request(app)
        .patch(`/api/staff/${outsider.id}/status`)
        .set(auth(f.managerToken))
        .send({ status: false }),
      404
    );

    expectFailure(
      await request(app)
        .put(`/api/staff/${outsider.id}`)
        .set(auth(f.managerToken))
        .send({ jobRole: "Manager" }),
      404
    );
  });

  it("stops a manager from moving their own staff into another branch", async () => {
    const f = await buildFixture();

    const created = await request(app)
      .post("/api/staff")
      .set(auth(f.managerToken))
      .send(staffPayload(f.stamp));
    expectSuccess(created, 201);
    const staffId = created.body.data.id as string;

    const moved = await request(app)
      .put(`/api/staff/${staffId}`)
      .set(auth(f.managerToken))
      .send({ branchId: f.otherBranch.id, jobRole: "Senior Stylist" });

    expectSuccess(moved, 200);
    expect(moved.body.data.branchId).toBe(f.homeBranch.id);
    expect(moved.body.data.jobRole).toBe("Senior Stylist");
  });

  it("refuses a login for a branch-locked user with no branch", async () => {
    const f = await buildFixture();
    const password = "Password@123";

    const stranded = await prisma.user.create({
      data: {
        name: "Stranded Staff",
        email: `stranded-${f.stamp}@example.com`,
        passwordHash: await hashPass(password),
        role: "STAFF",
        salonId: f.salon.id,
      },
    });

    expectFailure(
      await request(app)
        .post("/api/auth/login")
        .send({ email: stranded.email, password }),
      403
    );

    // An already-issued token must not keep working either.
    expectFailure(
      await request(app)
        .get("/api/auth/me")
        .set(
          auth(
            generateAccessToken({
              userId: stranded.id,
              role: stranded.role,
              salonId: f.salon.id,
            })
          )
        ),
      403
    );
  });

  it("keeps the salon admin's all-branches view intact", async () => {
    const f = await buildFixture();

    const [homeStaff, otherStaff] = await Promise.all([
      prisma.staff.create({
        data: {
          name: "Home Staff",
          email: `home-staff-${f.stamp}@example.com`,
          phone: `96${f.stamp.slice(-8)}`,
          jobRole: "Stylist",
          workingFrom: "10:00",
          workingTo: "19:00",
          weekOff: "MONDAY",
          salonId: f.salon.id,
          branchId: f.homeBranch.id,
        },
      }),
      prisma.staff.create({
        data: {
          name: "Other Staff",
          email: `other-staff-${f.stamp}@example.com`,
          phone: `95${f.stamp.slice(-8)}`,
          jobRole: "Stylist",
          workingFrom: "10:00",
          workingTo: "19:00",
          weekOff: "MONDAY",
          salonId: f.salon.id,
          branchId: f.otherBranch.id,
        },
      }),
    ]);

    const list = await request(app).get("/api/staff").set(auth(f.adminToken));
    expectSuccess(list, 200);

    const ids = (list.body.data as Array<{ id: string }>).map(
      (staff) => staff.id
    );
    expect(ids).toEqual(expect.arrayContaining([homeStaff.id, otherStaff.id]));
  });

  it("gives the manager salon-admin powers inside their own branch only", async () => {
    const f = await buildFixture();

    // Admin-level writes a manager may now make.
    const customer = await request(app)
      .post("/api/customers")
      .set(auth(f.managerToken))
      .send({
        name: `Scope Customer ${f.stamp}`,
        phone: `96${f.stamp.slice(-8)}`,
      });
    expectSuccess(customer, 201);
    expect(customer.body.data.branchId).toBe(f.homeBranch.id);

    // ...but not for another branch.
    expectFailure(
      await request(app)
        .post("/api/customers")
        .set(auth(f.managerToken))
        .send({
          name: `Outside Customer ${f.stamp}`,
          phone: `93${f.stamp.slice(-8)}`,
          branchId: f.otherBranch.id,
        }),
      403
    );

    const expense = await request(app)
      .post("/api/expenses")
      .set(auth(f.managerToken))
      .send({
        title: `Scope Expense ${f.stamp}`,
        amount: 100,
        category: "Misc",
        branchId: f.otherBranch.id,
      });
    expectSuccess(expense, 201);
    expect(expense.body.data.branchId).toBe(f.homeBranch.id);

    // Another branch's customer stays invisible.
    const outsider = await request(app)
      .post("/api/customers")
      .set(auth(f.adminToken))
      .send({
        name: "Outsider Customer",
        phone: `92${f.stamp.slice(-8)}`,
        branchId: f.otherBranch.id,
      });
    expectSuccess(outsider, 201);

    const customers = await request(app)
      .get("/api/customers")
      .set(auth(f.managerToken));
    expectSuccess(customers, 200);
    expect(
      (customers.body.data as Array<{ id: string }>).some(
        (row) => row.id === outsider.body.data.id
      )
    ).toBe(false);

    // Salon-wide actions stay with the salon admin.
    expectFailure(
      await request(app)
        .post("/api/branches")
        .set(auth(f.managerToken))
        .send({ name: `Sneaky Branch ${f.stamp}` }),
      403
    );

    expectFailure(
      await request(app)
        .post("/api/users/branch-manager")
        .set(auth(f.managerToken))
        .send({
          name: "Peer Manager",
          email: `peer-manager-${f.stamp}@example.com`,
          phone_number: `94${f.stamp.slice(-8)}`,
          password: "Password@123",
          branchId: f.homeBranch.id,
        }),
      403
    );

    expectFailure(
      await request(app)
        .get("/api/salons/gst/settings")
        .set(auth(f.managerToken)),
      403
    );
  });
});
