import request from "supertest";

import { app } from "../app.js";
import { prisma } from "../config/prisma.js";
import { generateAccessToken } from "../utils/jwt.js";

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const expectStatus = (res: request.Response, status: number) => {
  if (res.status !== status) {
    throw new Error(
      `Expected ${status}, received ${res.status}: ${JSON.stringify(res.body)}`
    );
  }
};

describe("Staff login provisioned with the staff record", () => {
  const stamp = Date.now();
  let token = "";
  let salonId = "";
  let branchId = "";

  const staffBody = (overrides: Record<string, unknown>) => ({
    phone: "9811100001",
    jobRole: "Stylist",
    workingFrom: "10:00",
    workingTo: "19:00",
    weekOff: "MONDAY",
    baseSalary: 20000,
    workingDaysPerMonth: 26,
    salonId,
    branchId,
    ...overrides,
  });

  beforeEach(async () => {
    const superAdmin = await prisma.user.create({
      data: {
        name: "Staff Login Super Admin",
        email: `staff-login-super-${stamp}@example.com`,
        passwordHash: "not-used",
        role: "SUPER_ADMIN",
      },
    });
    token = generateAccessToken({
      userId: superAdmin.id,
      role: superAdmin.role,
    });

    const salon = await request(app)
      .post("/api/salons")
      .set(auth(token))
      .send({ name: `Staff Login Salon ${stamp}` });
    expectStatus(salon, 201);
    salonId = salon.body.data.id;

    const branch = await request(app)
      .post("/api/branches")
      .set(auth(token))
      .send({ name: `Staff Login Branch ${stamp}`, salonId });
    expectStatus(branch, 201);
    branchId = branch.body.data.id;
  });

  it("creates a usable login when a password comes with the staff form", async () => {
    const email = `staff-login-${stamp}@example.com`;
    const password = "Password@123";

    const staff = await request(app)
      .post("/api/staff")
      .set(auth(token))
      .send(staffBody({ name: "Login Staff", email, password }));
    expectStatus(staff, 201);
    expect(staff.body.data.user).toMatchObject({
      role: "STAFF",
      email,
      salonId,
      branchId,
    });
    expect(staff.body.data.userId).toBe(staff.body.data.user.id);

    // The staff row is linked to the new user inside the same transaction.
    const linked = await prisma.staff.findUnique({
      where: { id: staff.body.data.id },
      select: { userId: true },
    });
    expect(linked?.userId).toBe(staff.body.data.user.id);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email, password });
    expectStatus(login, 200);
    expect(login.body.data.user).toMatchObject({
      role: "STAFF",
      salonId,
      branchId,
    });
  });

  it("creates no login and no staff row when the password is rejected", async () => {
    const email = `staff-short-pass-${stamp}@example.com`;

    const staff = await request(app)
      .post("/api/staff")
      .set(auth(token))
      .send(staffBody({ name: "Short Pass Staff", email, password: "12345" }));
    expectStatus(staff, 400);

    expect(await prisma.staff.findFirst({ where: { email } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it("rejects a password when the staff member has no branch", async () => {
    const email = `staff-no-branch-${stamp}@example.com`;

    const staff = await request(app)
      .post("/api/staff")
      .set(auth(token))
      .send(
        staffBody({
          name: "Branchless Staff",
          email,
          password: "Password@123",
          branchId: undefined,
        })
      );
    expectStatus(staff, 400);
    expect(await prisma.staff.findFirst({ where: { email } })).toBeNull();
  });

  it("still creates staff with no login when no password is sent", async () => {
    const email = `staff-no-pass-${stamp}@example.com`;

    const staff = await request(app)
      .post("/api/staff")
      .set(auth(token))
      .send(staffBody({ name: "No Login Staff", email, phone: "9811100002" }));
    expectStatus(staff, 201);
    expect(staff.body.data.user).toBeNull();
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();

    // The standalone endpoint still provisions the login afterwards.
    const account = await request(app)
      .post("/api/users/staff")
      .set(auth(token))
      .send({ staffId: staff.body.data.id, password: "Password@123" });
    expectStatus(account, 201);

    const duplicate = await request(app)
      .post("/api/users/staff")
      .set(auth(token))
      .send({ staffId: staff.body.data.id, password: "Password@123" });
    expectStatus(duplicate, 409);
  });
});
