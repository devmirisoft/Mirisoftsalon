import request from "supertest";

import { app } from "../app.js";
import { prisma } from "../config/prisma.js";
import { hashPass } from "../utils/password.js";

type Role =
  | "SUPER_ADMIN"
  | "SALON_ADMIN"
  | "BRANCH_MANAGER"
  | "RECEPTIONIST"
  | "STAFF";

describe("CRM logged-out and role access matrix", () => {
  it("checks public access, login, and representative permissions for every role", async () => {
    const stamp = Date.now();
    const password = "Password@123";
    const passwordHash = await hashPass(password);

    const salon = await prisma.salon.create({
      data: { name: `Role Matrix Salon ${stamp}` },
    });
    const branch = await prisma.branch.create({
      data: {
        name: `Role Matrix Branch ${stamp}`,
        salonId: salon.id,
      },
    });

    const roleUsers: Record<Role, { email: string; token?: string }> = {
      SUPER_ADMIN: { email: `matrix-super-${stamp}@example.com` },
      SALON_ADMIN: { email: `matrix-salon-${stamp}@example.com` },
      BRANCH_MANAGER: { email: `matrix-manager-${stamp}@example.com` },
      RECEPTIONIST: { email: `matrix-reception-${stamp}@example.com` },
      STAFF: { email: `matrix-staff-${stamp}@example.com` },
    };

    await Promise.all(
      (Object.entries(roleUsers) as [Role, { email: string }][]).map(
        ([role, user]) =>
          prisma.user.create({
            data: {
              name: `${role} Matrix User`,
              email: user.email,
              passwordHash,
              role,
              ...(role !== "SUPER_ADMIN" ? { salonId: salon.id } : {}),
              ...(role === "BRANCH_MANAGER" ||
              role === "RECEPTIONIST" ||
              role === "STAFF"
                ? { branchId: branch.id }
                : {}),
            },
          })
      )
    );

    expect((await request(app).get("/api/health")).status).toBe(200);
    expect((await request(app).get("/api/customers")).status).toBe(401);

    const publicTicket = await request(app)
      .post("/api/support-tickets/public")
      .send({
        reporterEmail: `public-${stamp}@example.com`,
        title: "Cannot log in",
        description: "Testing public support access",
        category: "LOGIN_ISSUE",
      });
    expect(publicTicket.status).toBe(201);

    for (const role of Object.keys(roleUsers) as Role[]) {
      const login = await request(app).post("/api/auth/login").send({
        email: roleUsers[role].email,
        password,
      });

      expect(login.status).toBe(200);
      expect(login.body.data.user.role).toBe(role);
      roleUsers[role].token = login.body.data.accessToken as string;

      const me = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${roleUsers[role].token}`);
      expect(me.status).toBe(200);
      expect(me.body.user.role).toBe(role);
    }

    const call = (role: Role, path: string) =>
      request(app)
        .get(path)
        .set("Authorization", `Bearer ${roleUsers[role].token}`);
    const post = (role: Role, path: string, body: object = {}) =>
      request(app)
        .post(path)
        .set("Authorization", `Bearer ${roleUsers[role].token}`)
        .send(body);

    expect((await call("SUPER_ADMIN", "/api/salons")).status).toBe(200);
    expect((await call("SUPER_ADMIN", "/api/users")).status).toBe(200);
    expect(
      (await call("SUPER_ADMIN", "/api/support-tickets")).status
    ).toBe(200);

    expect((await call("SALON_ADMIN", "/api/customers")).status).toBe(200);
    expect((await call("SALON_ADMIN", "/api/staff")).status).toBe(200);
    expect((await call("SALON_ADMIN", "/api/salons")).status).toBe(403);
    expect(
      (await call("SALON_ADMIN", "/api/support-tickets/my")).status
    ).toBe(200);

    // A branch manager is a salon admin scoped to one branch: it inherits the
    // salon admin's routes, minus the salon-wide ones.
    expect((await call("BRANCH_MANAGER", "/api/customers")).status).toBe(200);
    expect((await call("BRANCH_MANAGER", "/api/branches")).status).toBe(200);
    expect((await call("BRANCH_MANAGER", "/api/staff")).status).toBe(200);
    expect((await call("BRANCH_MANAGER", "/api/products")).status).toBe(200);
    expect((await call("BRANCH_MANAGER", "/api/expenses")).status).toBe(200);
    expect(
      (await call("BRANCH_MANAGER", "/api/support-tickets/my")).status
    ).toBe(200);
    expect((await call("BRANCH_MANAGER", "/api/salons")).status).toBe(403);
    expect((await post("BRANCH_MANAGER", "/api/branches")).status).toBe(403);
    expect(
      (await post("BRANCH_MANAGER", "/api/users/branch-manager")).status
    ).toBe(403);

    expect((await call("RECEPTIONIST", "/api/customers")).status).toBe(200);
    expect((await call("RECEPTIONIST", "/api/branches")).status).toBe(200);
    expect((await call("RECEPTIONIST", "/api/staff")).status).toBe(200);
    expect((await call("RECEPTIONIST", "/api/payments")).status).toBe(200);
    expect(
      (await call("RECEPTIONIST", "/api/support-tickets/my")).status
    ).toBe(200);
    expect((await post("RECEPTIONIST", "/api/staff")).status).toBe(403);
    expect((await post("RECEPTIONIST", "/api/salary-slips/generate")).status).toBe(403);

    expect((await call("STAFF", "/api/customers")).status).toBe(200);
    expect((await call("STAFF", "/api/services")).status).toBe(200);
    expect((await call("STAFF", "/api/payments")).status).toBe(403);
    expect((await call("STAFF", "/api/staff")).status).toBe(403);
    expect((await call("STAFF", "/api/branches")).status).toBe(403);
    expect(
      (await call("STAFF", "/api/support-tickets/my")).status
    ).toBe(200);
    expect((await post("STAFF", "/api/products")).status).toBe(403);
    expect((await post("STAFF", "/api/expenses")).status).toBe(403);
    expect((await post("STAFF", "/api/staff")).status).toBe(403);
    expect((await post("STAFF", "/api/salary-slips/generate")).status).toBe(403);
  });
});
