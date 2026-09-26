import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { app } from "../app.js";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";

const token = (user: { id: string; role: string; salonId?: string | null }) =>
  jwt.sign(
    { userId: user.id, role: user.role, ...(user.salonId ? { salonId: user.salonId } : {}) },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "15m" }
  );
const auth = (value: string) => ({ Authorization: `Bearer ${value}` });

type Line = { itemType: "SERVICE" | "PRODUCT"; serviceName: string; lineTotal: number; quantity?: number };

/** A fresh salon with an invoice factory, so every test owns its numbers. */
const fixture = async () => {
  const stamp = randomUUID();
  const salon = await prisma.salon.create({
    data: { name: `Service Wise ${stamp}`, timezone: "Asia/Kolkata" },
  });
  const admin = await prisma.user.create({
    data: {
      name: "Service Wise Admin",
      email: `service-wise-${stamp}@test.com`,
      passwordHash: "x",
      role: "SALON_ADMIN",
      salonId: salon.id,
    },
  });
  const customer = await prisma.customer.create({
    data: { customerCode: `SW-${stamp}`, name: "Ritu Verma", phone: "9216724100", salonId: salon.id },
  });
  let seq = 0;
  const bill = (lines: Line[], opts: { status?: "ISSUED" | "CANCELLED"; at?: Date } = {}) => {
    const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    return prisma.invoice.create({
      data: {
        invoiceCode: `SW-${stamp}-${++seq}`,
        salon: { connect: { id: salon.id } },
        customer: { connect: { id: customer.id } },
        customerName: customer.name,
        customerPhone: customer.phone,
        salonName: salon.name,
        // Mid-morning in Asia/Kolkata, so the bill lands on the report day.
        invoiceDate: opts.at ?? new Date("2026-05-10T06:00:00Z"),
        status: opts.status ?? "ISSUED",
        totalAmount: total,
        paidAmount: total,
        items: {
          create: lines.map((line) => ({
            ...line,
            quantity: line.quantity ?? 1,
            description: line.serviceName,
            unitPrice: line.lineTotal / (line.quantity ?? 1),
          })),
        },
      },
    });
  };
  const serviceWise = async (from = "2026-05-10", to = "2026-05-10") => {
    const response = await request(app)
      .get(`/api/reports/sales-dashboard?period=custom&from=${from}&to=${to}`)
      .set(auth(token(admin)));
    expect(response.status).toBe(200);
    return response.body.data.serviceWise as { name: string; count: number; amount: number }[];
  };
  return { bill, serviceWise };
};

describe("Sales report: service wise record", () => {
  it("adds up each service across bills and ranks by revenue", async () => {
    const f = await fixture();
    await f.bill([
      { itemType: "SERVICE", serviceName: "Men Hair Cut", lineTotal: 500 },
      { itemType: "SERVICE", serviceName: "Head Massage", lineTotal: 300 },
    ]);
    await f.bill([{ itemType: "SERVICE", serviceName: "Men Hair Cut", lineTotal: 1000, quantity: 2 }]);
    await f.bill([{ itemType: "SERVICE", serviceName: "Beard Trim", lineTotal: 150 }]);

    expect(await f.serviceWise()).toEqual([
      { name: "Men Hair Cut", count: 3, amount: 1500 },
      { name: "Head Massage", count: 1, amount: 300 },
      { name: "Beard Trim", count: 1, amount: 150 },
    ]);
  });

  it("leaves out products, cancelled bills and bills outside the period", async () => {
    const f = await fixture();
    await f.bill([
      { itemType: "SERVICE", serviceName: "Men Hair Cut", lineTotal: 500 },
      { itemType: "PRODUCT", serviceName: "Shampoo", lineTotal: 290 },
    ]);
    await f.bill([{ itemType: "SERVICE", serviceName: "Facial", lineTotal: 1200 }], { status: "CANCELLED" });
    await f.bill([{ itemType: "SERVICE", serviceName: "Pedicure", lineTotal: 800 }], {
      at: new Date("2026-05-12T06:00:00Z"),
    });

    expect(await f.serviceWise()).toEqual([{ name: "Men Hair Cut", count: 1, amount: 500 }]);
  });

  it("lists every service, not just the top ten", async () => {
    const f = await fixture();
    await f.bill(
      Array.from({ length: 12 }, (_, index) => ({
        itemType: "SERVICE" as const,
        serviceName: `Service ${index + 1}`,
        lineTotal: 100 * (index + 1),
      }))
    );

    const rows = await f.serviceWise();
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ name: "Service 12", count: 1, amount: 1200 });
    expect(rows[11]).toEqual({ name: "Service 1", count: 1, amount: 100 });
  });

  it("is empty for a period with no bills", async () => {
    const f = await fixture();
    expect(await f.serviceWise()).toEqual([]);
  });
});
