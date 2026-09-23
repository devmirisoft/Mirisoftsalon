import request from "supertest";

import { app } from "../app.js";
import { prisma } from "../config/prisma.js";
import { createAuditLog } from "../features/audit-logs/audit-log.service.js";
import { generateAccessToken } from "../utils/jwt.js";
import { hashPass } from "../utils/password.js";
import { randomUUID } from "node:crypto";

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let auditFailureTriggerInstalled = false;
const forceAuditFailure = async () => {
  if (auditFailureTriggerInstalled) return;
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION fail_audit_insert() RETURNS trigger AS $$ BEGIN IF NEW."entityName" LIKE 'FORCE_AUDIT_FAILURE%' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS force_audit_failure ON "AuditLog"`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER force_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fail_audit_insert()`);
  auditFailureTriggerInstalled = true;
};

const restoreAuditWrites = async () => {
  // The conditional trigger remains installed across rollback cases to avoid
  // repeated PostgreSQL DDL while Prisma's adapter is handling failed txs.
};

const removeAuditFailureTrigger = async () => {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS force_audit_failure ON "AuditLog"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_audit_insert()`);
  auditFailureTriggerInstalled = false;
};

beforeAll(removeAuditFailureTrigger);

const businessFixture = async (forceFailure = false) => {
  const marker = forceFailure ? "FORCE_AUDIT_FAILURE " : "";
  const salon = await prisma.salon.create({ data: { name: `Rollback ${randomUUID()}` } });
  const branch = await prisma.branch.create({ data: { name: "Rollback Branch", salonId: salon.id } });
  const admin = await prisma.user.create({ data: { name: "Rollback Admin", email: `${randomUUID()}@test.com`, passwordHash: "unused", role: "SALON_ADMIN", salonId: salon.id } });
  const customer = await prisma.customer.create({ data: { customerCode: `C-${randomUUID()}`, name: `${marker}Customer`, salonId: salon.id, branchId: branch.id, outstandingAmount: 100 } });
  const staff = await prisma.staff.create({ data: { name: `${marker}Staff`, email: `${randomUUID()}@staff.test`, jobRole: "Stylist", workingFrom: "09:00", workingTo: "18:00", weekOff: "SUNDAY", salonId: salon.id, branchId: branch.id } });
  const token = generateAccessToken({ userId: admin.id, role: admin.role, salonId: salon.id });
  return { salon, branch, admin, customer, staff, token };
};

describe("audit logs", () => {
  it("records successful and failed logins without credential data", async () => {
    const password = "Password@123";
    const user = await prisma.user.create({
      data: {
        name: "Audit Login User",
        email: "audit-login@example.com",
        passwordHash: await hashPass(password),
        role: "SUPER_ADMIN",
      },
    });

    expect(
      (await request(app).post("/api/auth/login").send({ email: user.email, password }))
        .status
    ).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .send({ email: user.email, password: "WrongPassword@123" })
      ).status
    ).toBe(401);

    const logs = await prisma.auditLog.findMany({
      where: { module: "AUTH" },
      orderBy: { createdAt: "asc" },
    });
    expect(logs.map((log) => log.action)).toEqual([
      "LOGIN_SUCCESS",
      "LOGIN_FAILED",
    ]);
    expect(JSON.stringify(logs)).not.toMatch(/Password@123|passwordHash|token/i);
  });

  it("sanitizes nested secrets before persisting audit JSON", async () => {
    const log = await createAuditLog({
      module: "SYSTEM",
      action: "UPDATE",
      description: "Redaction test",
      oldData: {
        password: "secret",
        safe: "visible",
        nested: { refreshToken: "secret", amount: 100 },
      },
      newData: { authorization: "Bearer secret", cardNumber: "4111111111111111" },
    });

    expect(log.oldData).toEqual({ password: "[REDACTED]", safe: "visible", nested: { refreshToken: "[REDACTED]", amount: 100 } });
    expect(log.newData).toEqual({ authorization: "[REDACTED]", cardNumber: "[REDACTED]" });
  });

  it("does not let failed-login audit failure replace the authentication response", async () => {
    await forceAuditFailure();
    try {
      const response = await request(app).post("/api/auth/login").send({ email: "FORCE_AUDIT_FAILURE@example.com", password: "Password@123" });
      expect(response.status).toBe(401);
      expect(response.body.message).toBe("Invalid email or password");
    } finally { await restoreAuditWrites(); }
  });

  it("does not let login-success audit failure break login or session creation", async () => {
    const password = "Password@123";
    const user = await prisma.user.create({ data: { name: "FORCE_AUDIT_FAILURE Login", email: "stable-login@test.com", passwordHash: await hashPass(password), role: "SUPER_ADMIN" } });
    await forceAuditFailure();
    try {
      const response = await request(app).post("/api/auth/login").send({ email: user.email, password });
      expect(response.status).toBe(200);
      expect(response.body.data.accessToken).toBeTruthy();
    } finally { await restoreAuditWrites(); }
    expect(await prisma.userSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(1);
  });

  it("revokes logout session and writes its audit in one transaction", async () => {
    const password = "Password@123";
    const user = await prisma.user.create({ data: { name: "Logout User", email: "logout-audit@test.com", passwordHash: await hashPass(password), role: "SUPER_ADMIN" } });
    const login = await request(app).post("/api/auth/login").send({ email: user.email, password });
    const cookie = login.headers["set-cookie"];
    const logout = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(logout.status).toBe(200);
    expect(await prisma.userSession.count({ where: { userId: user.id, revokedAt: { not: null } } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { userId: user.id, action: "LOGOUT" } })).toBe(1);
  });

  it("rolls back payment creation when audit insertion fails", async () => {
    const f = await businessFixture(true);
    const invoice = await prisma.invoice.create({ data: { invoiceCode: `INV-${randomUUID()}`, salonId: f.salon.id, branchId: f.branch.id, customerId: f.customer.id, salonName: f.salon.name, customerName: f.customer.name, subtotalAmount: 100, totalAmount: 100, balanceAmount: 100, status: "ISSUED", paymentStatus: "UNPAID" } });
    await forceAuditFailure();
    try {
      await request(app).post("/api/payments").set(auth(f.token)).send({ invoiceId: invoice.id, amount: 25, method: "CASH" }).expect(500);
    } finally { await restoreAuditWrites(); }
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
    expect(Number((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).paidAmount)).toBe(0);
  });

  it("rolls back appointment completion when audit insertion fails", async () => {
    const f = await businessFixture(true);
    const main = await prisma.mainService.create({ data: { name: "Rollback Main", salonId: f.salon.id } });
    const service = await prisma.service.create({ data: { name: "Rollback Service", price: 50, salonId: f.salon.id, branchId: f.branch.id, mainServiceId: main.id } });
    const product = await prisma.product.create({ data: { name: "Rollback Product", salonId: f.salon.id, branchId: f.branch.id, currentStock: 5, isServiceConsumable: true } });
    await prisma.serviceConsumable.create({ data: { salonId: f.salon.id, serviceId: service.id, productId: product.id, quantity: 2 } });
    const appointment = await prisma.appointment.create({ data: { appointmentCode: `APT-${randomUUID()}`, salonId: f.salon.id, branchId: f.branch.id, customerId: f.customer.id, staffId: f.staff.id, startTime: new Date("2030-01-01T10:00:00Z"), endTime: new Date("2030-01-01T11:00:00Z"), status: "CHECKED_IN", services: { create: { serviceId: service.id, serviceName: service.name, price: 50 } } } });
    await forceAuditFailure();
    try {
      await request(app).patch(`/api/appointments/${appointment.id}/status`).set(auth(f.token)).send({ status: "COMPLETED" }).expect(500);
    } finally { await restoreAuditWrites(); }
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("CHECKED_IN");
    expect(await prisma.appointmentStatusHistory.count({ where: { appointmentId: appointment.id } })).toBe(0);
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).currentStock)).toBe(5);
    expect(await prisma.productStockMovement.count({ where: { referenceId: appointment.id } })).toBe(0);
  });

  it("commits appointment cancellation, history and audit together", async () => {
    const f = await businessFixture();
    const appointment = await prisma.appointment.create({ data: { appointmentCode: `CANCEL-${randomUUID()}`, salonId: f.salon.id, branchId: f.branch.id, customerId: f.customer.id, staffId: f.staff.id, startTime: new Date("2030-03-01T10:00:00Z"), endTime: new Date("2030-03-01T11:00:00Z"), status: "SCHEDULED" } });
    await request(app).patch(`/api/appointments/${appointment.id}/status`).set(auth(f.token)).send({ status: "CANCELLED" }).expect(200);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe("CANCELLED");
    expect(await prisma.appointmentStatusHistory.count({ where: { appointmentId: appointment.id, newStatus: "CANCELLED" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: appointment.id, action: "CANCEL" } })).toBe(1);
  });

  it("rolls back salary paid status when audit insertion fails", async () => {
    const f = await businessFixture(true);
    const slip = await prisma.salarySlip.create({ data: { salonId: f.salon.id, branchId: f.branch.id, staffId: f.staff.id, month: 1, year: 2030, baseSalary: 1000, workingDays: 25, perDaySalary: 40, grossSalary: 1000, netSalary: 1000, status: "GENERATED" } });
    await forceAuditFailure();
    try {
      await request(app).patch(`/api/salary-slips/${slip.id}/mark-paid`).set(auth(f.token)).expect(500);
    } finally { await restoreAuditWrites(); }
    expect((await prisma.salarySlip.findUniqueOrThrow({ where: { id: slip.id } })).status).toBe("GENERATED");
  });

  it("rolls back support resolution when audit insertion fails", async () => {
    const f = await businessFixture(true);
    const superAdmin = await prisma.user.create({ data: { name: "Support Admin", email: `${randomUUID()}@support.test`, passwordHash: "unused", role: "SUPER_ADMIN" } });
    const ticket = await prisma.supportTicket.create({ data: { ticketCode: `SUP-${randomUUID()}`, reporterEmail: "reporter@test.com", title: "FORCE_AUDIT_FAILURE ticket", description: "Test", status: "IN_PROGRESS", salonId: f.salon.id, branchId: f.branch.id } });
    const token = generateAccessToken({ userId: superAdmin.id, role: superAdmin.role });
    await forceAuditFailure();
    try {
      await request(app).patch(`/api/support-tickets/${ticket.id}/status`).set(auth(token)).send({ status: "RESOLVED" }).expect(500);
    } finally { await restoreAuditWrites(); }
    expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe("IN_PROGRESS");
    expect(await prisma.supportTicketStatusHistory.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it("rolls back invoice edit when audit insertion fails", async () => {
    const f = await businessFixture(true);
    const invoice = await prisma.invoice.create({ data: { invoiceCode: `DRAFT-${randomUUID()}`, salonId: f.salon.id, branchId: f.branch.id, customerId: f.customer.id, salonName: f.salon.name, customerName: f.customer.name, subtotalAmount: 100, totalAmount: 100, balanceAmount: 100, status: "DRAFT", paymentStatus: "UNPAID" } });
    await forceAuditFailure();
    try {
      await request(app).put(`/api/invoices/${invoice.id}`).set(auth(f.token)).send({ discountAmount: 10, billingNote: "changed" }).expect(500);
    } finally { await restoreAuditWrites(); }
    const unchanged = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(Number(unchanged.discountAmount)).toBe(0);
    expect(unchanged.billingNote).toBeNull();
  });

  it("rolls back invoice generation, items, outstanding and ledger when audit insertion fails", async () => {
    const f = await businessFixture(true);
    const main = await prisma.mainService.create({ data: { name: "Invoice Main", salonId: f.salon.id } });
    const service = await prisma.service.create({ data: { name: "Invoice Service", price: 75, salonId: f.salon.id, branchId: f.branch.id, mainServiceId: main.id } });
    const appointment = await prisma.appointment.create({ data: { appointmentCode: `INV-APT-${randomUUID()}`, salonId: f.salon.id, branchId: f.branch.id, customerId: f.customer.id, staffId: f.staff.id, startTime: new Date("2030-02-01T10:00:00Z"), endTime: new Date("2030-02-01T11:00:00Z"), status: "COMPLETED", services: { create: { serviceId: service.id, serviceName: service.name, price: 75 } } } });
    const outstandingBefore = Number(f.customer.outstandingAmount);
    await forceAuditFailure();
    await request(app).post(`/api/invoices/from-appointment/${appointment.id}`).set(auth(f.token)).send({ invoiceType: "BILL_OF_SUPPLY" }).expect(500);
    expect(await prisma.invoice.count({ where: { appointmentId: appointment.id } })).toBe(0);
    expect(await prisma.customerTransaction.count({ where: { customerId: f.customer.id } })).toBe(0);
    expect(Number((await prisma.customer.findUniqueOrThrow({ where: { id: f.customer.id } })).outstandingAmount)).toBe(outstandingBefore);
  });

  it("rolls back membership creation when its audit fails", async () => {
    const f = await businessFixture();
    await forceAuditFailure();
    await request(app).post("/api/memberships").set(auth(f.token)).send({ name: "FORCE_AUDIT_FAILURE Gold", discountPercentage: 10 }).expect(500);
    expect(await prisma.membership.count({ where: { salonId: f.salon.id } })).toBe(0);
  });

  it("rolls back customer membership assignment when its audit fails", async () => {
    const f = await businessFixture(true);
    const membership = await prisma.membership.create({ data: { salonId: f.salon.id, name: "Gold", discountPercentage: 10 } });
    await forceAuditFailure();
    await request(app).patch(`/api/customers/${f.customer.id}/membership`).set(auth(f.token)).send({ membershipId: membership.id }).expect(500);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: f.customer.id } })).membershipId).toBeNull();
  });

  it("rolls back manual loyalty adjustment when its audit fails", async () => {
    const f = await businessFixture(true);
    await forceAuditFailure();
    await request(app).post(`/api/loyalty/customers/${f.customer.id}/adjust`).set(auth(f.token)).send({ points: 50, note: "test" }).expect(500);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: f.customer.id } })).loyaltyPoints).toBe(0);
    expect(await prisma.loyaltyTransaction.count({ where: { customerId: f.customer.id } })).toBe(0);
  });

  it("enforces safe invoice edits, recalculates drafts, and audits readable fields", async () => {
    const f = await businessFixture();
    const draft = await prisma.invoice.create({ data: { invoiceCode: `DRAFT-${randomUUID()}`, salonId: f.salon.id, branchId: f.branch.id, customerId: f.customer.id, salonName: f.salon.name, customerName: f.customer.name, subtotalAmount: 100, totalAmount: 100, balanceAmount: 100, status: "DRAFT", paymentStatus: "UNPAID" } });
    const edited = await request(app).put(`/api/invoices/${draft.id}`).set(auth(f.token)).send({ discountAmount: 10, processingFeeAmount: 5, taxAmount: 9, billingNote: "Adjusted before issue" });
    expect(edited.status).toBe(200);
    expect(Number(edited.body.data.totalAmount)).toBe(104);
    expect(Number(edited.body.data.balanceAmount)).toBe(104);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: draft.id, module: "INVOICE", action: "UPDATE" } });
    expect(log.description).toContain(draft.invoiceCode);
    expect(log.newData).toMatchObject({ invoiceCode: draft.invoiceCode, billingNote: "Adjusted before issue", totalAmount: "104" });

    const issued = await prisma.invoice.create({ data: { invoiceCode: `ISSUED-${randomUUID()}`, salonId: f.salon.id, customerId: f.customer.id, salonName: f.salon.name, customerName: f.customer.name, subtotalAmount: 50, totalAmount: 50, balanceAmount: 50, status: "ISSUED", paymentStatus: "UNPAID" } });
    await request(app).put(`/api/invoices/${issued.id}`).set(auth(f.token)).send({ discountAmount: 1 }).expect(409);
    await request(app).put(`/api/invoices/${issued.id}`).set(auth(f.token)).send({ footerNote: "Thank you" }).expect(200);
    await request(app).patch(`/api/invoices/${issued.id}/cancel`).set(auth(f.token)).expect(200);
    expect(await prisma.auditLog.count({ where: { entityId: issued.id, action: "CANCEL" } })).toBe(1);
    await request(app).put(`/api/invoices/${issued.id}`).set(auth(f.token)).send({ footerNote: "No longer editable" }).expect(409);

    const staffUser = await prisma.user.create({ data: { name: "Invoice Staff", email: `${randomUUID()}@invoice.test`, passwordHash: "unused", role: "STAFF", salonId: f.salon.id, branchId: f.branch.id } });
    const staffToken = generateAccessToken({ userId: staffUser.id, role: staffUser.role, salonId: f.salon.id, branchId: f.branch.id });
    await request(app).put(`/api/invoices/${draft.id}`).set(auth(staffToken)).send({ billingNote: "no" }).expect(403);

    const otherSalon = await prisma.salon.create({ data: { name: "Other invoice salon" } });
    const otherAdmin = await prisma.user.create({ data: { name: "Other Admin", email: `${randomUUID()}@other.test`, passwordHash: "unused", role: "SALON_ADMIN", salonId: otherSalon.id } });
    const otherToken = generateAccessToken({ userId: otherAdmin.id, role: otherAdmin.role, salonId: otherSalon.id });
    await request(app).put(`/api/invoices/${draft.id}`).set(auth(otherToken)).send({ billingNote: "no" }).expect(404);
    await removeAuditFailureTrigger();
  });

  it("enforces tenant and branch scope and denies staff access", async () => {
    const [salonA, salonB] = await Promise.all([
      prisma.salon.create({ data: { name: "Audit Salon A" } }),
      prisma.salon.create({ data: { name: "Audit Salon B" } }),
    ]);
    const [branchA1, branchA2] = await Promise.all([
      prisma.branch.create({ data: { name: "A1", salonId: salonA.id } }),
      prisma.branch.create({ data: { name: "A2", salonId: salonA.id } }),
    ]);
    const [admin, manager, staff] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Salon Admin",
          email: "audit-admin@example.com",
          passwordHash: "unused",
          role: "SALON_ADMIN",
          salonId: salonA.id,
        },
      }),
      prisma.user.create({
        data: {
          name: "Branch Manager",
          email: "audit-manager@example.com",
          passwordHash: "unused",
          role: "BRANCH_MANAGER",
          salonId: salonA.id,
          branchId: branchA1.id,
        },
      }),
      prisma.user.create({
        data: {
          name: "Staff",
          email: "audit-staff@example.com",
          passwordHash: "unused",
          role: "STAFF",
          salonId: salonA.id,
          branchId: branchA1.id,
        },
      }),
    ]);
    await Promise.all([
      createAuditLog({
        salonId: salonA.id,
        branchId: branchA1.id,
        module: "APPOINTMENT",
        action: "CREATE",
        description: "A1 log",
      }),
      createAuditLog({
        salonId: salonA.id,
        branchId: branchA2.id,
        module: "PAYMENT",
        action: "PAYMENT_RECORDED",
        description: "A2 log",
      }),
      createAuditLog({
        salonId: salonB.id,
        module: "SYSTEM",
        action: "UPDATE",
        description: "Other salon log",
      }),
    ]);

    const adminToken = generateAccessToken({
      userId: admin.id,
      role: admin.role,
      salonId: salonA.id,
    });
    const managerToken = generateAccessToken({
      userId: manager.id,
      role: manager.role,
      salonId: salonA.id,
      branchId: branchA1.id,
    });
    const staffToken = generateAccessToken({
      userId: staff.id,
      role: staff.role,
      salonId: salonA.id,
      branchId: branchA1.id,
    });

    const adminResponse = await request(app)
      .get(`/api/audit-logs?salonId=${salonB.id}`)
      .set(auth(adminToken));
    expect(adminResponse.status).toBe(200);
    expect(adminResponse.body.data).toHaveLength(2);
    expect(
      adminResponse.body.data.every(
        (log: { salonId: string | null }) => log.salonId === salonA.id
      )
    ).toBe(true);

    const managerResponse = await request(app)
      .get(`/api/audit-logs?branchId=${branchA2.id}`)
      .set(auth(managerToken));
    expect(managerResponse.status).toBe(200);
    expect(managerResponse.body.data).toHaveLength(1);
    expect(managerResponse.body.data[0].branchId).toBe(branchA1.id);

    expect(
      (await request(app).get("/api/audit-logs").set(auth(staffToken))).status
    ).toBe(403);
  });

  it("paginates and filters by module and action", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Audit Super Admin",
        email: "audit-super@example.com",
        passwordHash: "unused",
        role: "SUPER_ADMIN",
      },
    });
    await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        createAuditLog({
          module: index === 2 ? "PAYMENT" : "APPOINTMENT",
          action: index === 2 ? "PAYMENT_RECORDED" : "CREATE",
          description: `Pagination log ${index}`,
        })
      )
    );
    const token = generateAccessToken({ userId: user.id, role: user.role });

    const page = await request(app)
      .get("/api/audit-logs?page=2&limit=1&module=APPOINTMENT&action=CREATE")
      .set(auth(token));
    expect(page.status).toBe(200);
    expect(page.body.data).toHaveLength(1);
    expect(page.body.pagination).toEqual({
      page: 2,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
  });
});
