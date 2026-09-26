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

/** Two issued bills on the same local day: one paid in cash, one by UPI. */
const fixture = async () => {
  const stamp = randomUUID();
  const salon = await prisma.salon.create({
    data: { name: `EOD Salon ${stamp}`, timezone: "Asia/Kolkata" },
  });
  const admin = await prisma.user.create({
    data: {
      name: "EOD Admin",
      email: `eod-${stamp}@test.com`,
      passwordHash: "x",
      role: "SALON_ADMIN",
      salonId: salon.id,
    },
  });
  const customer = await prisma.customer.create({
    data: {
      customerCode: `EOD-${stamp}`,
      name: "Anita Sharma",
      phone: "9216724001",
      salonId: salon.id,
    },
  });
  // Mid-morning in Asia/Kolkata, so the bill lands on the same local day.
  const billedAt = new Date("2026-05-10T06:00:00Z");
  const makeInvoice = async (
    code: string,
    total: number,
    method: "CASH" | "UPI",
    items: { itemType: "SERVICE" | "PRODUCT"; serviceName: string; lineTotal: number }[]
  ) =>
    prisma.invoice.create({
      data: {
        invoiceCode: code,
        salon: { connect: { id: salon.id } },
        customer: { connect: { id: customer.id } },
        customerName: customer.name,
        customerPhone: customer.phone,
        salonName: salon.name,
        invoiceDate: billedAt,
        status: "ISSUED",
        totalAmount: total,
        paidAmount: total,
        billingNote: `note for ${code}`,
        items: {
          create: items.map((item) => ({
            ...item,
            description: item.serviceName,
            quantity: 1,
            unitPrice: item.lineTotal,
          })),
        },
        payments: {
          create: [
            {
              salon: { connect: { id: salon.id } },
              customer: { connect: { id: customer.id } },
              method,
              amount: total,
              paidAt: billedAt,
            },
          ],
        },
      },
    });

  await makeInvoice("EOD-1", 790, "CASH", [
    { itemType: "SERVICE", serviceName: "Men Hair Cut", lineTotal: 500 },
    { itemType: "PRODUCT", serviceName: "Shampoo", lineTotal: 290 },
  ]);
  await makeInvoice("EOD-2", 130, "UPI", [
    { itemType: "SERVICE", serviceName: "Women Eyebrows", lineTotal: 130 },
  ]);
  return { salon, adminToken: token(admin), day: "2026-05-10" };
};

describe("EOD report", () => {
  it("totals the day's bills and splits cash from online", async () => {
    const f = await fixture();
    const response = await request(app)
      .get(`/api/reports/eod?period=custom&from=${f.day}&to=${f.day}`)
      .set(auth(f.adminToken));

    expect(response.status).toBe(200);
    const data = response.body.data;
    expect(data.totalSales).toBe(2);
    expect(data.totalBillingCost).toBe(920);
    expect(data.cashReceived).toBe(790);
    expect(data.onlineReceived).toBe(130);
    expect(data.range).toMatchObject({ from: f.day, to: f.day });

    // The row carries the service/product split the counter reconciles.
    const row = data.rows.find((item: { invoiceCode: string }) => item.invoiceCode === "EOD-1");
    expect(row).toMatchObject({
      customerName: "Anita Sharma",
      customerPhone: "9216724001",
      serviceCost: 500,
      productCost: 290,
      salesCost: 790,
      comment: "note for EOD-1",
    });
    expect(row.services).toEqual(["Men Hair Cut"]);
    expect(row.products).toEqual(["Shampoo"]);
  });

  it("ranks top sellers and returns a gapless seven-day trend", async () => {
    const f = await fixture();
    const response = await request(app)
      .get(`/api/reports/eod?period=custom&from=${f.day}&to=${f.day}`)
      .set(auth(f.adminToken));

    expect(response.body.data.topServices.map((row: { name: string }) => row.name).sort()).toEqual([
      "Men Hair Cut",
      "Women Eyebrows",
    ]);
    expect(response.body.data.topProducts).toEqual([
      { name: "Shampoo", amount: 290, count: 1 },
    ]);
    const trend = response.body.data.trend;
    expect(trend).toHaveLength(7);
    expect(trend[6]).toMatchObject({ day: f.day, amount: 920, count: 2 });
    // Quiet days still appear, so the line has no gaps.
    expect(trend[0]).toMatchObject({ amount: 0, count: 0 });
  });

  it("spans the right window for the today, week and month tabs", async () => {
    const f = await fixture();
    const spanOf = async (period: string) => {
      const response = await request(app)
        .get(`/api/reports/eod?period=${period}`)
        .set(auth(f.adminToken));
      expect(response.status).toBe(200);
      const { from, to } = response.body.data.range;
      const days =
        (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
      return days;
    };
    // No period at all is the Today tab, so it must match period=day.
    expect(await spanOf("")).toBe(1);
    expect(await spanOf("day")).toBe(1);
    expect(await spanOf("week")).toBe(7);
    expect(await spanOf("month")).toBe(30);
  });

  it("applies the search filters that the page and its export share", async () => {
    const f = await fixture();
    const query = `period=custom&from=${f.day}&to=${f.day}`;

    const byMethod = await request(app)
      .get(`/api/reports/eod?${query}&methods=UPI`)
      .set(auth(f.adminToken));
    expect(byMethod.body.data.rows.map((row: { invoiceCode: string }) => row.invoiceCode)).toEqual(["EOD-2"]);

    const byName = await request(app)
      .get(`/api/reports/eod?${query}&name=anita`)
      .set(auth(f.adminToken));
    expect(byName.body.data.totalSales).toBe(2);

    const noMatch = await request(app)
      .get(`/api/reports/eod?${query}&phone=0000000`)
      .set(auth(f.adminToken));
    expect(noMatch.body.data.rows).toEqual([]);
    expect(noMatch.body.data.totalBillingCost).toBe(0);
  });
});
