import request from "supertest";
import jwt from "jsonwebtoken";

import { app } from "../app.js";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { generateAccessToken } from "../utils/jwt.js";

const makePhoneNumber = () => {
  return `9${Date.now().toString().slice(-9)}`;
};

const makeRegisterPayload = (overrides: Record<string, unknown> = {}) => {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return {
    salonName: `Test Salon ${stamp}`,
    branchName: "Main Branch",
    adminName: "Test Admin",
    email: `test-${stamp}@example.com`,
    phone: makePhoneNumber(),
    password: "Password@123",
    confirmPassword: "Password@123",
    ...overrides,
  };
};

describe("Auth API", () => {
  it("rate limits login attempts after five requests per IP", async () => {
    const responses = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      responses.push(
        await request(app)
          .post("/api/auth/login")
          .set("x-test-rate-limit", "enforce")
          .send({ email: "missing@example.com", password: "Password@123" })
      );
    }
    expect(responses.slice(0, 5).every((response) => response.status === 401)).toBe(true);
    expect(responses[5]?.status).toBe(429);
    expect(responses[5]?.body).toEqual({
      success: false,
      message: "Too many requests. Please try again later.",
    });
  });
  it("should register a new salon account with tenant-scoped SALON_ADMIN", async () => {
    const payload = makeRegisterPayload();

    const res = await request(app).post("/api/auth/register").send(payload);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Salon account created successfully");
    expect(res.body.data.salon.name).toBe(payload.salonName);
    expect(res.body.data.salon.timezone).toBe("Asia/Kolkata");
    expect(res.body.data.branch.name).toBe(payload.branchName);
    expect(res.body.data.branch.salonId).toBe(res.body.data.salon.id);
    expect(res.body.data.user.email).toBe(payload.email);
    expect(res.body.data.user.role).toBe("SALON_ADMIN");
    expect(res.body.data.user.salonId).toBe(res.body.data.salon.id);
    expect(res.body.data.user.branchId).toBe(res.body.data.branch.id);
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeUndefined();
    expect(res.headers["set-cookie"]).toBeDefined();

    await expect(prisma.salon.count()).resolves.toBe(1);
    await expect(prisma.branch.count()).resolves.toBe(1);
    await expect(prisma.user.count()).resolves.toBe(1);
    await expect(
      prisma.user.count({ where: { role: "SUPER_ADMIN" } })
    ).resolves.toBe(0);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: {
        module: "AUTH",
        action: "CREATE",
        entityId: res.body.data.user.id,
      },
    });
    expect(audit.description).toBe("New salon account registered");
    expect(JSON.stringify(audit.newData)).not.toMatch(/password|token|hash/i);
  });

  it("accepts legacy name and phone_number aliases as SALON_ADMIN onboarding fields", async () => {
    const payload = makeRegisterPayload();

    const res = await request(app)
      .post("/api/auth/register")
      .send({
        salonName: payload.salonName,
        branchName: payload.branchName,
        name: payload.adminName,
        email: payload.email,
        phone_number: payload.phone,
        password: payload.password,
        confirmPassword: payload.confirmPassword,
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.data.user.role).toBe("SALON_ADMIN");
    expect(res.body.data.user.name).toBe(payload.adminName);
    expect(res.body.data.user.phone).toBe(payload.phone);
    expect(res.body.data.user.salonId).toBe(res.body.data.salon.id);
    expect(res.body.data.user.branchId).toBe(res.body.data.branch.id);
  });

  it("should login a registered user", async () => {
    const payload = makeRegisterPayload({ email: `login${Date.now()}@example.com` });
    const password = "Password@123";

    const registration = await request(app).post("/api/auth/register").send(payload);

    const res = await request(app).post("/api/auth/login").send({
      email: payload.email,
      password,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.refreshToken).toBeUndefined();
    expect(res.body.data.user.id).toBe(registration.body.data.user.id);
    expect(res.body.data.user.email).toBe(payload.email);
    expect(res.body.data.user.role).toBe("SALON_ADMIN");
    expect(res.body.data.user.salonId).toBe(registration.body.data.salon.id);
    expect(res.body.data.user.branchId).toBe(registration.body.data.branch.id);
    expect(res.headers["set-cookie"]).toBeDefined();

    const decoded = jwt.verify(
      res.body.data.accessToken,
      env.JWT_ACCESS_SECRET
    ) as { userId: string; role: string; salonId: string; branchId: string };
    expect(decoded.userId).toBe(registration.body.data.user.id);
    expect(decoded.role).toBe("SALON_ADMIN");
    expect(decoded.salonId).toBe(registration.body.data.salon.id);
    expect(decoded.branchId).toBe(registration.body.data.branch.id);
  });

  it("rejects public attempts to inject role or tenant scope", async () => {
    for (const protectedField of ["role", "salonId", "branchId"]) {
      const res = await request(app)
        .post("/api/auth/register")
        .send(makeRegisterPayload({ [protectedField]: "SUPER_ADMIN" }));

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain("server-controlled");
    }
  });

  it("rejects duplicate email and password mismatch", async () => {
    const payload = makeRegisterPayload();
    await request(app).post("/api/auth/register").send(payload).expect(201);

    const duplicate = await request(app)
      .post("/api/auth/register")
      .send(makeRegisterPayload({ email: payload.email }));
    expect(duplicate.statusCode).toBe(409);

    const mismatch = await request(app)
      .post("/api/auth/register")
      .send(makeRegisterPayload({ confirmPassword: "Different123" }));
    expect(mismatch.statusCode).toBe(400);
  });

  it("registered SALON_ADMIN has own-salon access without SUPER_ADMIN privileges", async () => {
    const registration = await request(app)
      .post("/api/auth/register")
      .send(makeRegisterPayload());
    const token = registration.body.data.accessToken as string;
    const auth = { Authorization: `Bearer ${token}` };

    await request(app).get("/api/customers").set(auth).expect(200);
    await request(app).get("/api/salons").set(auth).expect(403);

    const otherSalon = await prisma.salon.create({ data: { name: "Other Salon" } });
    const otherBranch = await prisma.branch.create({
      data: { name: "Other Branch", salonId: otherSalon.id },
    });
    const otherCustomer = await prisma.customer.create({
      data: {
        customerCode: "OTHER-001",
        name: "Other Customer",
        phone: "8111111111",
        salonId: otherSalon.id,
        branchId: otherBranch.id,
      },
    });

    await request(app)
      .get(`/api/branches/${otherBranch.id}`)
      .set(auth)
      .expect(404);
    await request(app)
      .get(`/api/customers/${otherCustomer.id}`)
      .set(auth)
      .expect(404);
  });

  it("authenticated context for registered user works with SALON_ADMIN AI assistant access", async () => {
    const registration = await request(app)
      .post("/api/auth/register")
      .send(makeRegisterPayload());

    const response = await request(app)
      .post("/api/ai-assistant/chat")
      .set("Authorization", `Bearer ${registration.body.data.accessToken}`)
      .send({ message: "How much revenue today?" });

    expect(response.statusCode).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it("req.user resolves registered SALON_ADMIN context from the database after login", async () => {
    const payload = makeRegisterPayload();
    const registration = await request(app).post("/api/auth/register").send(payload);
    const login = await request(app).post("/api/auth/login").send({
      email: payload.email,
      password: payload.password,
    });

    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${login.body.data.accessToken}`);

    expect(me.statusCode).toBe(200);
    expect(me.body.user).toEqual({
      userId: registration.body.data.user.id,
      role: "SALON_ADMIN",
      salonId: registration.body.data.salon.id,
      branchId: registration.body.data.branch.id,
    });

    const forgedToken = generateAccessToken({
      userId: registration.body.data.user.id,
      role: "SUPER_ADMIN",
    });
    const forged = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${forgedToken}`);
    expect(forged.body.user.role).toBe("SALON_ADMIN");
  });

  it("should clear the refresh cookie without requiring an access token", async () => {
    const res = await request(app).post("/api/auth/logout");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.headers["set-cookie"]?.[0]).toContain("refreshToken=;");
  });

  it("creates, validates, and revokes a hashed refresh session", async () => {
    const agent = request.agent(app);
    const registration = await agent.post("/api/auth/register").send(makeRegisterPayload({
      adminName: "Session User",
      email: `session-${Date.now()}@example.com`,
    }));
    expect(registration.statusCode).toBe(201);

    const session = await prisma.userSession.findFirstOrThrow({
      where: { userId: registration.body.data.user.id },
    });
    expect(session.refreshTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(session.revokedAt).toBeNull();
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());

    expect((await agent.post("/api/auth/refresh")).statusCode).toBe(200);
    expect((await agent.post("/api/auth/logout")).statusCode).toBe(200);
    expect(
      (await prisma.userSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt
    ).not.toBeNull();
    expect((await agent.post("/api/auth/refresh")).statusCode).toBe(401);
  });

  it("rejects refresh for a disabled user", async () => {
    const agent = request.agent(app);
    const registration = await agent.post("/api/auth/register").send(makeRegisterPayload({
      adminName: "Disabled Session User",
      email: `disabled-session-${Date.now()}@example.com`,
    }));
    await prisma.user.update({
      where: { id: registration.body.data.user.id },
      data: { status: "DISABLED" },
    });
    const refresh = await agent.post("/api/auth/refresh");
    expect(refresh.statusCode).toBe(403);
    expect(refresh.body.message).toBe("Account is disabled");
  });
});
