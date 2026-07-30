import request from "supertest";
import { app } from "../app.js";
import { prisma } from "../config/prisma.js";
import { generateAccessToken } from "../utils/jwt.js";

const auth = (token: string) => ({
  Authorization: `Bearer ${token}`,
});

describe("Staff code generation", () => {
  it("uses salon initials, joining month, ISO weekday, and phone suffix", async () => {
    const stamp = Date.now();
    const superAdmin = await prisma.user.create({
      data: {
        name: "Staff Code Super Admin",
        email: `staff-code-${stamp}@example.com`,
        passwordHash: "not-used",
        role: "SUPER_ADMIN",
      },
    });
    const token = generateAccessToken({
      userId: superAdmin.id,
      role: superAdmin.role,
    });

    const salon = await request(app)
      .post("/api/salons")
      .set(auth(token))
      .send({
        name: "Sassy Salon",
      });

    expect(salon.status).toBe(201);

    const staff = await request(app)
      .post("/api/staff")
      .set(auth(token))
      .send({
        name: "Wednesday Staff",
        email: `wednesday-staff-${stamp}@example.com`,
        phone: "9876543809",
        jobRole: "Stylist",
        workingFrom: "10:00",
        workingTo: "19:00",
        weekOff: "MONDAY",
        joiningDate: "2026-06-03T10:00:00.000Z",
        salonId: salon.body.data.id,
      });

    expect(staff.status).toBe(201);
    expect(staff.body.data.staffCode).toBe("SS-06-3-809");
    expect(staff.body.data.joiningDate).toBe("2026-06-03T10:00:00.000Z");

    const duplicate = await request(app)
      .post("/api/staff")
      .set(auth(token))
      .send({
        name: "Duplicate Code Staff",
        email: `duplicate-staff-${stamp}@example.com`,
        phone: "9000000809",
        jobRole: "Stylist",
        workingFrom: "10:00",
        workingTo: "19:00",
        weekOff: "TUESDAY",
        joiningDate: "2026-06-03T12:00:00.000Z",
        salonId: salon.body.data.id,
      });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.message).toBe("Staff code already exists");
  });
});
