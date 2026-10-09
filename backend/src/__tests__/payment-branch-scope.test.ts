import request from "supertest";

import { app } from "../app.js";
import { prisma } from "../config/prisma.js";
import { hashPass } from "../utils/password.js";
import { generateAccessToken } from "../utils/jwt.js";

// Payments were filtered by salon only, so a receptionist in one branch could
// list, open and pay another branch's money. These pin them to their branch,
// and an admin to the branch session they have open.

const auth = (token: string, branchId?: string) => ({
  Authorization: `Bearer ${token}`,
  ...(branchId ? { "X-Branch-Id": branchId } : {}),
});

const buildFixture = async () => {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const salon = await prisma.salon.create({
    data: { name: `Payment Scope Salon ${stamp}` },
  });
  const [mohali, whitefield] = await Promise.all([
    prisma.branch.create({ data: { name: `MOHALI ${stamp}`, salonId: salon.id } }),
    prisma.branch.create({
      data: { name: `Glow Whitefield ${stamp}`, salonId: salon.id },
    }),
  ]);

  const seedBranch = async (branchId: string, tag: string, digit: string) => {
    const customer = await prisma.customer.create({
      data: {
        name: `${tag} Customer`,
        phone: `8${digit}${stamp.slice(-8)}`,
        customerCode: `PAY-${tag}-${stamp}`,
        salonId: salon.id,
        branchId,
      },
    });
    const invoice = (code: string) =>
      prisma.invoice.create({
        data: {
          invoiceCode: `${code}-${stamp}`,
          salonId: salon.id,
          branchId,
          customerId: customer.id,
          salonName: salon.name,
          customerName: customer.name,
          status: "ISSUED",
          paymentStatus: "UNPAID",
          totalAmount: 1000,
          balanceAmount: 1000,
        },
      });
    const [paidInvoice, openInvoice] = await Promise.all([
      invoice(`INV-${tag}-1`),
      invoice(`INV-${tag}-2`),
    ]);
    const payment = await prisma.payment.create({
      data: {
        salonId: salon.id,
        branchId,
        customerId: customer.id,
        invoiceId: paidInvoice.id,
        amount: 200,
        method: "CASH",
      },
    });
    return { openInvoice, payment };
  };

  const [home, other] = await Promise.all([
    seedBranch(mohali.id, "MOH", "1"),
    seedBranch(whitefield.id, "WHF", "2"),
  ]);

  const user = (role: "RECEPTIONIST" | "SALON_ADMIN", branchId?: string) =>
    hashPass("Password@123").then((passwordHash) =>
      prisma.user.create({
        data: {
          name: `${role} ${stamp}`,
          email: `${role.toLowerCase()}-pay-${stamp}@example.com`,
          passwordHash,
          role,
          salonId: salon.id,
          ...(branchId ? { branchId } : {}),
        },
      })
    );
  const [receptionist, admin] = await Promise.all([
    user("RECEPTIONIST", mohali.id),
    user("SALON_ADMIN"),
  ]);
  const token = (u: { id: string; role: string; branchId: string | null }) =>
    generateAccessToken({
      userId: u.id,
      role: u.role,
      salonId: salon.id,
      ...(u.branchId ? { branchId: u.branchId } : {}),
    });

  return {
    mohali,
    whitefield,
    home,
    other,
    receptionistToken: token(receptionist),
    adminToken: token(admin),
  };
};

const ids = (res: request.Response) =>
  (res.body.data as Array<{ id: string }>).map((row) => row.id);

describe("Payment branch scope", () => {
  it("lists only the receptionist's own branch payments", async () => {
    const f = await buildFixture();

    const res = await request(app)
      .get("/api/payments")
      .set(auth(f.receptionistToken));
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([f.home.payment.id]);
  });

  it("refuses a receptionist asking for another branch's payments", async () => {
    const f = await buildFixture();

    const res = await request(app)
      .get("/api/payments")
      .query({ branchId: f.whitefield.id })
      .set(auth(f.receptionistToken));
    expect(res.status).toBe(403);
    expect(res.body.data).toBeUndefined();
  });

  it("ignores X-Branch-Id from a receptionist", async () => {
    const f = await buildFixture();

    const res = await request(app)
      .get("/api/payments")
      .set(auth(f.receptionistToken, f.whitefield.id));
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([f.home.payment.id]);
  });

  it("hides another branch's payment by id", async () => {
    const f = await buildFixture();

    const other = await request(app)
      .get(`/api/payments/${f.other.payment.id}`)
      .set(auth(f.receptionistToken));
    expect(other.status).toBe(404);

    const own = await request(app)
      .get(`/api/payments/${f.home.payment.id}`)
      .set(auth(f.receptionistToken));
    expect(own.status).toBe(200);
    expect(own.body.data.id).toBe(f.home.payment.id);
  });

  it("refuses to record a payment against another branch's invoice", async () => {
    const f = await buildFixture();

    const res = await request(app)
      .post("/api/payments")
      .set(auth(f.receptionistToken))
      .send({ invoiceId: f.other.openInvoice.id, amount: 100, method: "CASH" });
    expect(res.status).toBe(404);

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: f.other.openInvoice.id },
    });
    expect(Number(invoice.paidAmount)).toBe(0);
    expect(
      await prisma.payment.count({ where: { invoiceId: f.other.openInvoice.id } })
    ).toBe(0);
  });

  it("still records a payment against the receptionist's own invoice", async () => {
    const f = await buildFixture();

    const res = await request(app)
      .post("/api/payments")
      .set(auth(f.receptionistToken))
      .send({ invoiceId: f.home.openInvoice.id, amount: 400, method: "UPI" });
    expect(res.status).toBe(201);
    expect(res.body.data.payment.branch.id).toBe(f.mohali.id);

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: f.home.openInvoice.id },
    });
    expect(Number(invoice.paidAmount)).toBe(400);
    expect(Number(invoice.balanceAmount)).toBe(600);
  });

  it("narrows an admin to the open branch session and keeps all branches otherwise", async () => {
    const f = await buildFixture();

    const all = await request(app).get("/api/payments").set(auth(f.adminToken));
    expect(all.status).toBe(200);
    expect(ids(all).sort()).toEqual(
      [f.home.payment.id, f.other.payment.id].sort()
    );

    // The session wins over a stale ?branchId= for the other branch.
    const scoped = await request(app)
      .get("/api/payments")
      .query({ branchId: f.mohali.id })
      .set(auth(f.adminToken, f.whitefield.id));
    expect(scoped.status).toBe(200);
    expect(ids(scoped)).toEqual([f.other.payment.id]);

    const byId = await request(app)
      .get(`/api/payments/${f.home.payment.id}`)
      .set(auth(f.adminToken, f.whitefield.id));
    expect(byId.status).toBe(404);

    const pay = await request(app)
      .post("/api/payments")
      .set(auth(f.adminToken, f.whitefield.id))
      .send({ invoiceId: f.home.openInvoice.id, amount: 100, method: "CASH" });
    expect(pay.status).toBe(404);
  });
});
