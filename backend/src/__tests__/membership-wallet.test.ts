import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";

import { app } from "../app.js";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const tokenFor = (actor: {
  id: string;
  role: string;
  salonId?: string | null;
  branchId?: string | null;
}) =>
  jwt.sign(
    {
      userId: actor.id,
      role: actor.role,
      ...(actor.salonId ? { salonId: actor.salonId } : {}),
      ...(actor.branchId ? { branchId: actor.branchId } : {}),
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "15m" }
  );

const fixture = async () => {
  const stamp = randomUUID();
  const salon = await prisma.salon.create({
    data: { name: `Wallet Salon ${stamp}` },
  });
  const branch = await prisma.branch.create({
    data: { salonId: salon.id, name: `Wallet Branch ${stamp}` },
  });
  const admin = await prisma.user.create({
    data: {
      name: "Wallet Admin",
      email: `wallet-admin-${stamp}@example.com`,
      passwordHash: "test",
      role: "SALON_ADMIN",
      salonId: salon.id,
    },
  });
  const receptionist = await prisma.user.create({
    data: {
      name: "Wallet Receptionist",
      email: `wallet-reception-${stamp}@example.com`,
      passwordHash: "test",
      role: "RECEPTIONIST",
      salonId: salon.id,
      branchId: branch.id,
    },
  });
  const customer = await prisma.customer.create({
    data: {
      salonId: salon.id,
      branchId: branch.id,
      name: "Wallet Customer",
      phone: `9${stamp.replace(/\D/g, "").slice(0, 9)}`,
      customerCode: `WC-${stamp.slice(0, 8)}`,
    },
  });

  return {
    salon,
    branch,
    customer,
    adminToken: tokenFor(admin),
    receptionistToken: tokenFor(receptionist),
  };
};

const createPlan = (
  token: string,
  body: Record<string, unknown>
) =>
  request(app).post("/api/memberships").set(auth(token)).send(body);

const assignPlan = (
  token: string,
  customerId: string,
  body: Record<string, unknown>
) =>
  request(app)
    .post(`/api/customers/${customerId}/memberships`)
    .set(auth(token))
    .send(body);

const createIssuedInvoice = async (
  f: Awaited<ReturnType<typeof fixture>>,
  totalAmount: number
) => {
  const invoice = await prisma.invoice.create({
    data: {
      invoiceCode: `WAL-INV-${randomUUID().slice(0, 8)}`,
      salonId: f.salon.id,
      branchId: f.branch.id,
      customerId: f.customer.id,
      salonName: f.salon.name,
      customerName: f.customer.name,
      subtotalAmount: totalAmount,
      totalAmount,
      balanceAmount: totalAmount,
      status: "ISSUED",
      paymentStatus: "UNPAID",
    },
  });
  await prisma.customer.update({
    where: { id: f.customer.id },
    data: { outstandingAmount: { increment: totalAmount } },
  });
  return invoice;
};

describe("Membership wallet", () => {
  it("stores duration and wallet credit on the plan", async () => {
    const f = await fixture();
    const response = await createPlan(f.adminToken, {
      name: `Gold ${randomUUID().slice(0, 8)}`,
      discountPercentage: 10,
      durationMonths: 12,
      price: 5000,
      walletCreditAmount: 6000,
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ durationMonths: 12 });
    expect(Number(response.body.data.price)).toBe(5000);
    expect(Number(response.body.data.walletCreditAmount)).toBe(6000);
  });

  it("rejects a duration that is not a positive whole number of months", async () => {
    const f = await fixture();
    const response = await createPlan(f.adminToken, {
      name: `Bad ${randomUUID().slice(0, 8)}`,
      discountPercentage: 5,
      durationMonths: 2.5,
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/whole number of months/i);
  });

  it("treats a blank duration as a membership that never expires", async () => {
    const f = await fixture();
    const plan = await createPlan(f.adminToken, {
      name: `Lifetime ${randomUUID().slice(0, 8)}`,
      discountPercentage: 5,
      durationMonths: "",
      walletCreditAmount: 1000,
    });
    expect(plan.status).toBe(201);
    expect(plan.body.data.durationMonths).toBeNull();

    const assigned = await assignPlan(f.adminToken, f.customer.id, {
      membershipId: plan.body.data.id,
    });
    expect(assigned.status).toBe(201);
    expect(assigned.body.data.expiresAt).toBeNull();
  });

  it("derives expiry from the duration of the plan and credits the wallet", async () => {
    const f = await fixture();
    const plan = await createPlan(f.adminToken, {
      name: `Silver ${randomUUID().slice(0, 8)}`,
      discountPercentage: 10,
      durationMonths: 6,
      price: 3000,
      walletCreditAmount: 3500,
    });
    expect(plan.status).toBe(201);

    const assigned = await assignPlan(f.adminToken, f.customer.id, {
      membershipId: plan.body.data.id,
    });
    expect(assigned.status).toBe(201);

    const row = await prisma.customerMembership.findUniqueOrThrow({
      where: { id: assigned.body.data.id },
    });
    expect(row.durationMonthsSnapshot).toBe(6);
    expect(Number(row.walletBalance)).toBe(3500);
    expect(Number(row.walletCredited)).toBe(3500);
    expect(row.expiresAt).not.toBeNull();

    const expected = new Date(row.startsAt);
    expected.setMonth(expected.getMonth() + 6);
    expect(row.expiresAt!.toISOString()).toBe(expected.toISOString());

    const ledger = await prisma.membershipWalletTransaction.findMany({
      where: { customerMembershipId: row.id },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.type).toBe("PURCHASE_CREDIT");
    expect(Number(ledger[0]!.credit)).toBe(3500);
    expect(Number(ledger[0]!.balanceAfter)).toBe(3500);
  });

  it("tops up an active wallet and records the movement", async () => {
    const f = await fixture();
    const plan = await createPlan(f.adminToken, {
      name: `Topup ${randomUUID().slice(0, 8)}`,
      durationMonths: 3,
      walletCreditAmount: 1000,
    });
    const assigned = await assignPlan(f.adminToken, f.customer.id, {
      membershipId: plan.body.data.id,
    });
    const membershipId = assigned.body.data.id;

    const topUp = await request(app)
      .post(`/api/membership-wallets/${membershipId}/topup`)
      .set(auth(f.receptionistToken))
      .send({ amount: 500 });
    expect(topUp.status).toBe(201);

    const wallet = await request(app)
      .get(`/api/membership-wallets/${membershipId}`)
      .set(auth(f.adminToken));
    expect(wallet.status).toBe(200);
    expect(Number(wallet.body.data.walletBalance)).toBe(1500);
    expect(wallet.body.data.spendable).toBe(true);
  });

  it("refuses to overdraw the wallet", async () => {
    const f = await fixture();
    const plan = await createPlan(f.adminToken, {
      name: `Small ${randomUUID().slice(0, 8)}`,
      durationMonths: 3,
      walletCreditAmount: 100,
    });
    const assigned = await assignPlan(f.adminToken, f.customer.id, {
      membershipId: plan.body.data.id,
    });

    const response = await request(app)
      .post(`/api/membership-wallets/${assigned.body.data.id}/adjust`)
      .set(auth(f.adminToken))
      .send({ amount: 250, direction: "DEBIT" });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/insufficient/i);

    const row = await prisma.customerMembership.findUniqueOrThrow({
      where: { id: assigned.body.data.id },
    });
    expect(Number(row.walletBalance)).toBe(100);
  });

  it("keeps manual adjustments away from non-admin roles", async () => {
    const f = await fixture();
    const plan = await createPlan(f.adminToken, {
      name: `Guarded ${randomUUID().slice(0, 8)}`,
      durationMonths: 3,
      walletCreditAmount: 500,
    });
    const assigned = await assignPlan(f.adminToken, f.customer.id, {
      membershipId: plan.body.data.id,
    });

    const response = await request(app)
      .post(`/api/membership-wallets/${assigned.body.data.id}/adjust`)
      .set(auth(f.receptionistToken))
      .send({ amount: 50, direction: "CREDIT" });

    expect(response.status).toBe(403);
  });

  it("forfeits the remaining balance when a membership is cancelled", async () => {
    const f = await fixture();
    const plan = await createPlan(f.adminToken, {
      name: `Forfeit ${randomUUID().slice(0, 8)}`,
      durationMonths: 6,
      walletCreditAmount: 2000,
    });
    const assigned = await assignPlan(f.adminToken, f.customer.id, {
      membershipId: plan.body.data.id,
    });
    const membershipId = assigned.body.data.id;

    const cancelled = await request(app)
      .patch(`/api/customer-memberships/${membershipId}/cancel`)
      .set(auth(f.adminToken));
    expect(cancelled.status).toBe(200);

    const row = await prisma.customerMembership.findUniqueOrThrow({
      where: { id: membershipId },
    });
    expect(row.status).toBe("CANCELLED");
    expect(Number(row.walletBalance)).toBe(0);
    expect(Number(row.forfeitedAmount)).toBe(2000);
    expect(row.forfeitedAt).not.toBeNull();

    const forfeitRows = await prisma.membershipWalletTransaction.findMany({
      where: { customerMembershipId: membershipId, type: "FORFEIT" },
    });
    expect(forfeitRows).toHaveLength(1);
    expect(Number(forfeitRows[0]!.debit)).toBe(2000);
  });

  it("forfeits the wallet of a membership superseded by a renewal", async () => {
    const f = await fixture();
    const first = await createPlan(f.adminToken, {
      name: `First ${randomUUID().slice(0, 8)}`,
      durationMonths: 6,
      walletCreditAmount: 800,
    });
    const second = await createPlan(f.adminToken, {
      name: `Second ${randomUUID().slice(0, 8)}`,
      durationMonths: 6,
      walletCreditAmount: 1200,
    });

    const firstAssigned = await assignPlan(f.adminToken, f.customer.id, {
      membershipId: first.body.data.id,
    });
    const secondAssigned = await assignPlan(f.adminToken, f.customer.id, {
      membershipId: second.body.data.id,
    });
    expect(secondAssigned.status).toBe(201);

    const oldRow = await prisma.customerMembership.findUniqueOrThrow({
      where: { id: firstAssigned.body.data.id },
    });
    expect(oldRow.status).toBe("REMOVED");
    expect(Number(oldRow.walletBalance)).toBe(0);
    expect(Number(oldRow.forfeitedAmount)).toBe(800);

    const newRow = await prisma.customerMembership.findUniqueOrThrow({
      where: { id: secondAssigned.body.data.id },
    });
    expect(newRow.status).toBe("ACTIVE");
    expect(Number(newRow.walletBalance)).toBe(1200);
  });

  it("blocks topping up a wallet whose membership has ended", async () => {
    const f = await fixture();
    const plan = await createPlan(f.adminToken, {
      name: `Ended ${randomUUID().slice(0, 8)}`,
      durationMonths: 6,
      walletCreditAmount: 400,
    });
    const assigned = await assignPlan(f.adminToken, f.customer.id, {
      membershipId: plan.body.data.id,
    });
    await request(app)
      .patch(`/api/customer-memberships/${assigned.body.data.id}/cancel`)
      .set(auth(f.adminToken));

    const response = await request(app)
      .post(`/api/membership-wallets/${assigned.body.data.id}/topup`)
      .set(auth(f.adminToken))
      .send({ amount: 100 });

    expect(response.status).toBe(409);
  });

  it("lists wallet transactions scoped to the salon of the caller", async () => {
    const f = await fixture();
    const other = await fixture();
    const plan = await createPlan(f.adminToken, {
      name: `Ledger ${randomUUID().slice(0, 8)}`,
      durationMonths: 6,
      walletCreditAmount: 900,
    });
    await assignPlan(f.adminToken, f.customer.id, {
      membershipId: plan.body.data.id,
    });

    const mine = await request(app)
      .get("/api/membership-wallets/transactions")
      .set(auth(f.adminToken));
    expect(mine.status).toBe(200);
    expect(mine.body.data.length).toBeGreaterThan(0);

    const theirs = await request(app)
      .get("/api/membership-wallets/transactions")
      .set(auth(other.adminToken));
    expect(theirs.status).toBe(200);
    expect(theirs.body.data).toHaveLength(0);
  });

  it("lets the wallet credit be overridden for a single sale", async () => {
    const f = await fixture();
    const plan = await createPlan(f.adminToken, {
      name: `Override ${randomUUID().slice(0, 8)}`,
      durationMonths: 6,
      walletCreditAmount: 1000,
    });

    const assigned = await assignPlan(f.adminToken, f.customer.id, {
      membershipId: plan.body.data.id,
      walletCreditAmount: 2500,
    });
    expect(assigned.status).toBe(201);

    const row = await prisma.customerMembership.findUniqueOrThrow({
      where: { id: assigned.body.data.id },
    });
    expect(Number(row.walletBalance)).toBe(2500);
  });

  it("settles an invoice from the membership wallet", async () => {
    const f = await fixture();
    const plan = await createPlan(f.adminToken, {
      name: `Payer ${randomUUID().slice(0, 8)}`,
      durationMonths: 6,
      walletCreditAmount: 5000,
    });
    const assigned = await assignPlan(f.adminToken, f.customer.id, {
      membershipId: plan.body.data.id,
    });
    const invoice = await createIssuedInvoice(f, 1200);

    const response = await request(app)
      .post("/api/membership-wallets/pay")
      .set(auth(f.receptionistToken))
      .send({ invoiceId: invoice.id });

    expect(response.status).toBe(201);

    const settled = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    expect(settled.paymentStatus).toBe("PAID");
    expect(Number(settled.paidAmount)).toBe(1200);
    expect(Number(settled.balanceAmount)).toBe(0);

    const wallet = await prisma.customerMembership.findUniqueOrThrow({
      where: { id: assigned.body.data.id },
    });
    expect(Number(wallet.walletBalance)).toBe(3800);

    const payment = await prisma.payment.findFirstOrThrow({
      where: { invoiceId: invoice.id },
    });
    expect(payment.method).toBe("MEMBERSHIP_WALLET");
    expect(Number(payment.amount)).toBe(1200);

    const spend = await prisma.membershipWalletTransaction.findFirstOrThrow({
      where: { invoiceId: invoice.id, type: "SPEND" },
    });
    expect(Number(spend.debit)).toBe(1200);
    expect(spend.paymentId).toBe(payment.id);

    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id: f.customer.id },
    });
    expect(Number(customer.outstandingAmount)).toBe(0);
  });

  it("settles part of an invoice and leaves the rest outstanding", async () => {
    const f = await fixture();
    const plan = await createPlan(f.adminToken, {
      name: `Partial ${randomUUID().slice(0, 8)}`,
      durationMonths: 6,
      walletCreditAmount: 5000,
    });
    await assignPlan(f.adminToken, f.customer.id, {
      membershipId: plan.body.data.id,
    });
    const invoice = await createIssuedInvoice(f, 2000);

    const response = await request(app)
      .post("/api/membership-wallets/pay")
      .set(auth(f.adminToken))
      .send({ invoiceId: invoice.id, amount: 750 });

    expect(response.status).toBe(201);

    const settled = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    expect(settled.paymentStatus).toBe("PARTIALLY_PAID");
    expect(Number(settled.paidAmount)).toBe(750);
    expect(Number(settled.balanceAmount)).toBe(1250);
  });

  it("rejects a wallet payment larger than the invoice balance", async () => {
    const f = await fixture();
    const plan = await createPlan(f.adminToken, {
      name: `TooMuch ${randomUUID().slice(0, 8)}`,
      durationMonths: 6,
      walletCreditAmount: 9000,
    });
    await assignPlan(f.adminToken, f.customer.id, {
      membershipId: plan.body.data.id,
    });
    const invoice = await createIssuedInvoice(f, 500);

    const response = await request(app)
      .post("/api/membership-wallets/pay")
      .set(auth(f.adminToken))
      .send({ invoiceId: invoice.id, amount: 900 });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/greater than invoice balance/i);
  });

  it("leaves the wallet untouched when the balance cannot cover the bill", async () => {
    const f = await fixture();
    const plan = await createPlan(f.adminToken, {
      name: `Short ${randomUUID().slice(0, 8)}`,
      durationMonths: 6,
      walletCreditAmount: 300,
    });
    const assigned = await assignPlan(f.adminToken, f.customer.id, {
      membershipId: plan.body.data.id,
    });
    const invoice = await createIssuedInvoice(f, 1000);

    const response = await request(app)
      .post("/api/membership-wallets/pay")
      .set(auth(f.adminToken))
      .send({ invoiceId: invoice.id });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/insufficient/i);

    const wallet = await prisma.customerMembership.findUniqueOrThrow({
      where: { id: assigned.body.data.id },
    });
    expect(Number(wallet.walletBalance)).toBe(300);

    const unchanged = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    expect(unchanged.paymentStatus).toBe("UNPAID");
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
  });

  it("refuses to pay from the wallet of a cancelled membership", async () => {
    const f = await fixture();
    const plan = await createPlan(f.adminToken, {
      name: `Dead ${randomUUID().slice(0, 8)}`,
      durationMonths: 6,
      walletCreditAmount: 5000,
    });
    const assigned = await assignPlan(f.adminToken, f.customer.id, {
      membershipId: plan.body.data.id,
    });
    await request(app)
      .patch(`/api/customer-memberships/${assigned.body.data.id}/cancel`)
      .set(auth(f.adminToken));
    const invoice = await createIssuedInvoice(f, 400);

    const response = await request(app)
      .post("/api/membership-wallets/pay")
      .set(auth(f.adminToken))
      .send({ invoiceId: invoice.id });

    expect(response.status).toBe(400);
  });

  it("reports the spendable wallet for a customer to the billing screen", async () => {
    const f = await fixture();
    const plan = await createPlan(f.adminToken, {
      name: `Summary ${randomUUID().slice(0, 8)}`,
      durationMonths: 6,
      walletCreditAmount: 1500,
    });
    await assignPlan(f.adminToken, f.customer.id, {
      membershipId: plan.body.data.id,
    });

    const response = await request(app)
      .get(`/api/membership-wallets/customer/${f.customer.id}`)
      .set(auth(f.receptionistToken));

    expect(response.status).toBe(200);
    expect(Number(response.body.data.spendableBalance)).toBe(1500);
    expect(response.body.data.memberships).toHaveLength(1);
    expect(response.body.data.customer.id).toBe(f.customer.id);
  });

  it("reports a zero spendable wallet once the membership has ended", async () => {
    const f = await fixture();
    const plan = await createPlan(f.adminToken, {
      name: `Gone ${randomUUID().slice(0, 8)}`,
      durationMonths: 6,
      walletCreditAmount: 700,
    });
    const assigned = await assignPlan(f.adminToken, f.customer.id, {
      membershipId: plan.body.data.id,
    });
    await request(app)
      .patch(`/api/customer-memberships/${assigned.body.data.id}/cancel`)
      .set(auth(f.adminToken));

    const response = await request(app)
      .get(`/api/membership-wallets/customer/${f.customer.id}`)
      .set(auth(f.adminToken));

    expect(response.status).toBe(200);
    expect(Number(response.body.data.spendableBalance)).toBe(0);
    expect(response.body.data.memberships).toHaveLength(0);
  });

  it("does not expose the wallet of a customer in another salon", async () => {
    const f = await fixture();
    const other = await fixture();
    const plan = await createPlan(f.adminToken, {
      name: `Private ${randomUUID().slice(0, 8)}`,
      durationMonths: 6,
      walletCreditAmount: 900,
    });
    await assignPlan(f.adminToken, f.customer.id, {
      membershipId: plan.body.data.id,
    });

    const response = await request(app)
      .get(`/api/membership-wallets/customer/${f.customer.id}`)
      .set(auth(other.adminToken));

    expect(response.status).toBe(404);
  });
});
