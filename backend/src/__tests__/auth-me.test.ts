import request from "supertest";
import jwt from "jsonwebtoken";

import { app } from "../app.js";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { generateAccessToken } from "../utils/jwt.js";

const makeRegisterPayload = (overrides: Record<string, unknown> = {}) => {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    salonName: `Me Salon ${stamp}`,
    branchName: "Main Branch",
    adminName: "Me User",
    email: `me-${stamp}@example.com`,
    phone: `7${stamp.slice(-9)}`,
    password: "Password@123",
    confirmPassword: "Password@123",
    ...overrides,
  };
};

describe("Protected Auth Routes", () => {
  it("should return current token payload with valid token", async () => {
    const registerRes = await request(app)
      .post("/api/auth/register")
      .send(makeRegisterPayload());

    const token = registerRes.body.data.accessToken;

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.userId).toBe(registerRes.body.data.user.id);
    expect(res.body.user.role).toBe("SALON_ADMIN");
    expect(res.body.user.salonId).toBe(registerRes.body.data.salon.id);
    expect(res.body.user.branchId).toBe(registerRes.body.data.branch.id);
  });

  it("should reject request without token", async () => {
    const res = await request(app).get("/api/auth/me");

    expect(res.statusCode).toBe(401);
  });

  it("rejects invalid and expired access tokens", async () => {
    const invalid = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer definitely-not-a-jwt");
    expect(invalid.statusCode).toBe(401);

    const expired = jwt.sign(
      { userId: "expired-user", role: "SUPER_ADMIN" },
      env.JWT_ACCESS_SECRET,
      { expiresIn: -1 }
    );
    const expiredResponse = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${expired}`);
    expect(expiredResponse.statusCode).toBe(401);
  });

  it("rejects a token after its user is deleted", async () => {
    const registerRes = await request(app)
      .post("/api/auth/register")
      .send(makeRegisterPayload({
        adminName: "Deleted Token User",
        email: `deleted-${Date.now()}@example.com`,
      }));
    expect(registerRes.statusCode).toBe(201);

    await prisma.user.delete({ where: { id: registerRes.body.data.user.id } });

    const response = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${registerRes.body.data.accessToken}`);
    expect(response.statusCode).toBe(401);
  });

  it("rejects salon-scoped access for a user without salonId", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Unscoped Admin",
        email: `unscoped-${Date.now()}@example.com`,
        passwordHash: "not-used",
        role: "SALON_ADMIN",
      },
    });
    const token = generateAccessToken({ userId: user.id, role: user.role });

    const response = await request(app)
      .get("/api/customers")
      .set("Authorization", `Bearer ${token}`);
    expect(response.statusCode).toBe(400);
  });

  it("blocks disabled users and enforces tenant-scoped status administration", async () => {
    const stamp = Date.now();
    const password = "Password@123";
    const superUser = await prisma.user.create({
      data: {
        name: "Status Super Admin",
        email: `status-super-${stamp}@example.com`,
        passwordHash: "not-used",
        role: "SUPER_ADMIN",
      },
    });
    const superToken = generateAccessToken({
      userId: superUser.id,
      role: superUser.role,
    });
    const auth = { Authorization: `Bearer ${superToken}` };

    const salonA = await request(app).post("/api/salons").set(auth).send({ name: `Status Salon A ${stamp}` });
    const salonB = await request(app).post("/api/salons").set(auth).send({ name: `Status Salon B ${stamp}` });
    const createAdmin = (salonId: string, suffix: string) =>
      request(app).post("/api/users/salon-admin").set(auth).send({
        name: `Status Admin ${suffix}`,
        email: `status-admin-${suffix}-${stamp}@example.com`,
        phone_number: `${suffix === "a" ? "41" : "42"}${String(stamp).slice(-8)}`,
        password,
        salonId,
      });
    const adminA = await createAdmin(salonA.body.data.id, "a");
    const adminB = await createAdmin(salonB.body.data.id, "b");
    const adminALogin = await request(app).post("/api/auth/login").send({
      email: adminA.body.data.email,
      password,
    });
    const adminAToken = adminALogin.body.data.accessToken as string;

    const crossTenantDisable = await request(app)
      .patch(`/api/users/${adminB.body.data.id}/status`)
      .set("Authorization", `Bearer ${adminAToken}`)
      .send({ status: "DISABLED" });
    expect(crossTenantDisable.statusCode).toBe(403);

    const disabled = await request(app)
      .patch(`/api/users/${adminA.body.data.id}/status`)
      .set(auth)
      .send({ status: "DISABLED" });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.body.data.status).toBe("DISABLED");

    const disabledToken = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${adminAToken}`);
    expect(disabledToken.statusCode).toBe(403);
    expect(disabledToken.body.message).toBe("Account is disabled");

    const disabledLogin = await request(app).post("/api/auth/login").send({
      email: adminA.body.data.email,
      password,
    });
    expect(disabledLogin.statusCode).toBe(403);
    expect(disabledLogin.body.message).toBe("Account is disabled");
  });
});
