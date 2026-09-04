import request from "supertest";
import { app } from "../app.js";
import { prisma } from "../config/prisma.js";
import { generateAccessToken } from "../utils/jwt.js";

describe("connected staff payroll", () => {
  const fixture = async () => {
    const salon = await prisma.salon.create({ data: { name: "Payroll Salon", phone: "9999999999", email: "payroll@test.com" } });
    const otherSalon = await prisma.salon.create({ data: { name: "Other Payroll Salon" } });
    const branch = await prisma.branch.create({ data: { name: "Payroll Branch", salonId: salon.id } });
    const otherBranch = await prisma.branch.create({ data: { name: "Other Branch", salonId: otherSalon.id } });
    const admin = await prisma.user.create({ data: { name: "Payroll Admin", email: "payroll-admin@test.com", passwordHash: "x", role: "SALON_ADMIN", salonId: salon.id } });
    const otherAdmin = await prisma.user.create({ data: { name: "Other Admin", email: "other-payroll-admin@test.com", passwordHash: "x", role: "SALON_ADMIN", salonId: otherSalon.id } });
    const receptionist = await prisma.user.create({ data: { name: "Payroll Receptionist", email: "payroll-receptionist@test.com", passwordHash: "x", role: "RECEPTIONIST", salonId: salon.id, branchId: branch.id } });
    const staffUser = await prisma.user.create({ data: { name: "Payroll Staff User", email: "payroll-staff-user@test.com", passwordHash: "x", role: "STAFF", salonId: salon.id, branchId: branch.id } });
    const secondUser = await prisma.user.create({ data: { name: "Second Staff User", email: "second-payroll-user@test.com", passwordHash: "x", role: "STAFF", salonId: salon.id, branchId: branch.id } });
    const staff = await prisma.staff.create({ data: { name: "Payroll Staff", email: "payroll-staff@test.com", jobRole: "Stylist", workingFrom: "10:00", workingTo: "19:00", weekOff: "MONDAY", salonId: salon.id, branchId: branch.id, userId: staffUser.id } });
    const secondStaff = await prisma.staff.create({ data: { name: "Second Staff", email: "second-payroll-staff@test.com", jobRole: "Stylist", workingFrom: "10:00", workingTo: "19:00", weekOff: "TUESDAY", salonId: salon.id, branchId: branch.id, userId: secondUser.id } });
    const otherStaff = await prisma.staff.create({ data: { name: "Other Staff", email: "other-payroll-staff@test.com", jobRole: "Stylist", workingFrom: "10:00", workingTo: "19:00", weekOff: "MONDAY", salonId: otherSalon.id, branchId: otherBranch.id } });
    const token = (user: typeof admin) => generateAccessToken({ userId: user.id, role: user.role, ...(user.salonId ? { salonId: user.salonId } : {}), ...(user.branchId ? { branchId: user.branchId } : {}) });
    return { salon, otherSalon, branch, admin, staff, secondStaff, otherStaff, adminToken: token(admin), otherAdminToken: token(otherAdmin), receptionistToken: token(receptionist), staffToken: token(staffUser), secondStaffToken: token(secondUser) };
  };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const configBody = (overrides = {}) => ({ baseSalary: 26000, salaryType: "MONTHLY", workingDaysPerMonth: 26, paidLeavesAllowed: 1, lateGraceMinutes: 10, latePenaltyType: "FIXED_PER_LATE_DAY", latePenaltyAmount: 50, serviceCommissionPercentage: 10, serviceMinimumWorkThreshold: 1000, retailCommissionPercentage: 5, retailMinimumSalesThreshold: 500, effectiveFrom: "2026-01-01", ...overrides });
  const uatConfigBody = () => ({ baseSalary: 20000, salaryType: "MONTHLY", workingDaysPerMonth: 26, paidLeavesAllowed: 2, lateGraceMinutes: 10, latePenaltyType: "FIXED_PER_LATE_DAY", latePenaltyAmount: 100, serviceCommissionPercentage: 10, serviceMinimumWorkThreshold: 50000, retailCommissionPercentage: 5, retailMinimumSalesThreshold: 10000, effectiveFrom: "2026-01-01" });

  it("creates the salary config with the staff and only revises it when it changes", async () => {
    const f = await fixture();
    const created = await request(app).post("/api/staff").set(auth(f.adminToken)).send({ name: "Hired Staff", email: "hired-payroll-staff@test.com", phone: "9876543210", jobRole: "Stylist", workingFrom: "10:00", workingTo: "19:00", weekOff: "MONDAY", branchId: f.branch.id, ...uatConfigBody() });
    expect(created.status).toBe(201);
    const staffId = created.body.data.id;
    const first = created.body.data.salaryConfigs[0];
    expect(Number(first.baseSalary)).toBe(20000);
    expect(Number(first.serviceMinimumWorkThreshold)).toBe(50000);
    expect(Number(first.retailMinimumSalesThreshold)).toBe(10000);

    const raised = await request(app).put(`/api/staff/${staffId}`).set(auth(f.adminToken)).send(configBody({ baseSalary: 30000, effectiveFrom: "2026-07-01" }));
    expect(raised.status).toBe(200);
    const old = await prisma.staffSalaryConfig.findUniqueOrThrow({ where: { id: first.id } });
    expect(old.status).toBe(false); expect(old.effectiveTo).not.toBeNull();
    const active = await prisma.staffSalaryConfig.findFirstOrThrow({ where: { staffId, status: true } });
    expect(Number(active.baseSalary)).toBe(30000);

    const unchanged = await request(app).put(`/api/staff/${staffId}`).set(auth(f.adminToken)).send(configBody({ baseSalary: 30000, effectiveFrom: "2026-07-01" }));
    expect(unchanged.status).toBe(200);
    expect(await prisma.staffSalaryConfig.count({ where: { staffId } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { salonId: f.salon.id, module: "SALARY", action: "SALARY_CHANGED" } })).toBe(2);
  });

  it("rejects staff creation without salary details", async () => {
    const f = await fixture();
    const missing = await request(app).post("/api/staff").set(auth(f.adminToken)).send({ name: "No Salary", email: "no-salary@test.com", phone: "9876543211", jobRole: "Stylist", workingFrom: "10:00", workingTo: "19:00", weekOff: "MONDAY" });
    expect(missing.status).toBe(400);
    const invalid = await request(app).post("/api/staff").set(auth(f.adminToken)).send({ name: "Bad Salary", email: "bad-salary@test.com", phone: "9876543212", jobRole: "Stylist", workingFrom: "10:00", workingTo: "19:00", weekOff: "MONDAY", ...configBody({ baseSalary: -1 }) });
    expect(invalid.status).toBe(400);
    expect(await prisma.staff.count({ where: { email: "no-salary@test.com" } })).toBe(0);
  });

  it("credits optional staff on retail sales, decrements stock, and rejects cross-salon attribution", async () => {
    const f = await fixture();
    const product = await prisma.product.create({ data: { salonId: f.salon.id, branchId: f.branch.id, name: "Payroll Shampoo", currentStock: 10, sellingPrice: 100, isRetailProduct: true } });
    const sale = await request(app).post("/api/retail-sales").set(auth(f.adminToken)).send({ branchId: f.branch.id, staffId: f.staff.id, items: [{ productId: product.id, quantity: 2, unitPrice: 100 }] });
    expect(sale.status).toBe(201); expect(sale.body.data.staff.id).toBe(f.staff.id);
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).currentStock)).toBe(8);
    const invalid = await request(app).post("/api/retail-sales").set(auth(f.adminToken)).send({ branchId: f.branch.id, staffId: f.otherStaff.id, items: [{ productId: product.id, quantity: 1, unitPrice: 100 }] });
    expect(invalid.status).toBe(404);
  });

  const addFinalServiceRevenue = async (f: Awaited<ReturnType<typeof fixture>>, amount: number) => {
    const customer = await prisma.customer.create({ data: { customerCode: "PAY-CUST", name: "Payroll Customer", salonId: f.salon.id, branchId: f.branch.id } });
    const main = await prisma.mainService.create({ data: { name: "Hair", salonId: f.salon.id } });
    const service = await prisma.service.create({ data: { name: "Cut", price: amount, salonId: f.salon.id, branchId: f.branch.id, mainServiceId: main.id } });
    const appointment = await prisma.appointment.create({ data: { appointmentCode: "PAY-APT", salonId: f.salon.id, branchId: f.branch.id, customerId: customer.id, staffId: f.staff.id, startTime: new Date("2026-06-10T10:00:00Z"), endTime: new Date("2026-06-10T11:00:00Z"), status: "COMPLETED", services: { create: { serviceId: service.id, serviceName: service.name, price: amount } } } });
    const invoice = await prisma.invoice.create({ data: { invoiceCode: "PAY-INV", salonId: f.salon.id, branchId: f.branch.id, customerId: customer.id, appointmentId: appointment.id, invoiceDate: new Date("2026-06-10T11:00:00Z"), salonName: f.salon.name, customerName: customer.name, totalAmount: amount, paidAmount: amount, status: "ISSUED", paymentStatus: "PAID", items: { create: { serviceId: service.id, description: service.name, serviceName: service.name, quantity: 1, unitPrice: amount, lineTotal: amount } } } });
    return invoice;
  };

  it("generates the full snapshot, applies fixed late penalty, thresholds, formula, duplicate rule, payment lock, PDF, and staff isolation", async () => {
    const f = await fixture();
    await prisma.staffSalaryConfig.create({ data: { salonId: f.salon.id, branchId: f.branch.id, staffId: f.staff.id, ...configBody(), effectiveFrom: new Date("2026-01-01") } });
    await prisma.staffAttendance.create({ data: { salonId: f.salon.id, branchId: f.branch.id, staffId: f.staff.id, date: new Date("2026-06-02"), status: "LATE", lateMinutes: 20 } });
    await prisma.staffLeave.create({ data: { salonId: f.salon.id, branchId: f.branch.id, staffId: f.staff.id, leaveType: "UNPAID_LEAVE", startDate: new Date("2026-06-03"), endDate: new Date("2026-06-03"), totalDays: 1, status: "APPROVED" } });
    await addFinalServiceRevenue(f, 1000);
    await prisma.retailSale.create({ data: { saleCode: "PAY-RET", salonId: f.salon.id, branchId: f.branch.id, staffId: f.staff.id, saleDate: new Date("2026-06-12"), totalAmount: 500 } });
    const generated = await request(app).post("/api/salary-slips/generate").set(auth(f.adminToken)).send({ staffId: f.staff.id, month: 6, year: 2026, bonusAmount: 100, manualDeduction: 25 });
    expect(generated.status).toBe(201);
    expect((await request(app).post("/api/salary-slips/generate").set(auth(f.staffToken)).send({ staffId: f.staff.id, month: 7, year: 2026 })).status).toBe(403);
    expect((await request(app).post("/api/salary-slips/generate").set(auth(f.receptionistToken)).send({ staffId: f.staff.id, month: 7, year: 2026 })).status).toBe(403);
    expect((await request(app).post("/api/staff").set(auth(f.receptionistToken)).send(configBody())).status).toBe(403);
    expect(Number(generated.body.data.serviceCommissionAmount)).toBe(100);
    expect(Number(generated.body.data.retailCommissionAmount)).toBe(25);
    expect(Number(generated.body.data.latePenalty)).toBe(50);
    expect(Number(generated.body.data.unpaidLeaveDeduction)).toBe(1000);
    expect(Number(generated.body.data.grossSalary)).toBe(26225);
    expect(Number(generated.body.data.netSalary)).toBe(25150);
    expect((await request(app).post("/api/salary-slips/generate").set(auth(f.adminToken)).send({ staffId: f.staff.id, month: 6, year: 2026 })).status).toBe(409);
    const id = generated.body.data.id;
    expect((await request(app).get(`/api/salary-slips/${id}`).set(auth(f.secondStaffToken))).status).toBe(403);
    expect((await request(app).get(`/api/salary-slips/${id}`).set(auth(f.otherAdminToken))).status).toBe(403);
    const pdf = await request(app).get(`/api/salary-slips/${id}/pdf`).set(auth(f.staffToken));
    expect(pdf.status).toBe(200); expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect((await request(app).patch(`/api/salary-slips/${id}/mark-paid`).set(auth(f.adminToken))).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { entityId: id, action: { in: ["SALARY_GENERATED", "SALARY_PAID"] } } })).toBe(2);
    expect((await request(app).patch(`/api/salary-slips/${id}/mark-paid`).set(auth(f.adminToken))).status).toBe(409);
    expect((await request(app).patch(`/api/salary-slips/${id}/cancel`).set(auth(f.adminToken))).status).toBe(409);
  });

  it("uses per-minute penalties and returns zero commissions below thresholds", async () => {
    const f = await fixture();
    await prisma.staffSalaryConfig.create({ data: { salonId: f.salon.id, branchId: f.branch.id, staffId: f.staff.id, ...configBody({ latePenaltyType: "PER_LATE_MINUTE", latePenaltyAmount: 2, serviceMinimumWorkThreshold: 2000, retailMinimumSalesThreshold: 1000 }), effectiveFrom: new Date("2026-01-01") } });
    await prisma.staffAttendance.create({ data: { salonId: f.salon.id, branchId: f.branch.id, staffId: f.staff.id, date: new Date("2026-06-02"), status: "LATE", lateMinutes: 15 } });
    await addFinalServiceRevenue(f, 1000);
    await prisma.retailSale.create({ data: { saleCode: "LOW-RET", salonId: f.salon.id, branchId: f.branch.id, staffId: f.staff.id, saleDate: new Date("2026-06-12"), totalAmount: 500 } });
    const result = await request(app).post("/api/salary-slips/generate").set(auth(f.adminToken)).send({ staffId: f.staff.id, month: 6, year: 2026 });
    expect(result.status).toBe(201); expect(Number(result.body.data.latePenalty)).toBe(30);
    expect(Number(result.body.data.serviceCommissionAmount)).toBe(0); expect(Number(result.body.data.retailCommissionAmount)).toBe(0);
    expect((await request(app).patch(`/api/salary-slips/${result.body.data.id}/cancel`).set(auth(f.adminToken))).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { entityId: result.body.data.id, action: { in: ["SALARY_GENERATED", "CANCEL"] } } })).toBe(2);
  });

  it("returns a salon-isolated staff performance report", async () => {
    const f = await fixture();
    const secondBranch = await prisma.branch.create({ data: { name: "Second Payroll Branch", salonId: f.salon.id } });
    const outsideBranchStaff = await prisma.staff.create({ data: { name: "Outside Branch Staff", email: "outside-branch@test.com", jobRole: "Stylist", workingFrom: "10:00", workingTo: "19:00", weekOff: "MONDAY", salonId: f.salon.id, branchId: secondBranch.id } });
    const manager = await prisma.user.create({ data: { name: "Payroll Manager", email: "payroll-manager@test.com", passwordHash: "x", role: "BRANCH_MANAGER", salonId: f.salon.id, branchId: f.branch.id } });
    const managerToken = generateAccessToken({ userId: manager.id, role: manager.role, salonId: f.salon.id, branchId: f.branch.id });
    const response = await request(app).get("/api/reports/staff-performance?month=6&year=2026").set(auth(f.adminToken));
    expect(response.status).toBe(200);
    expect(response.body.data.map((x: { staffId: string }) => x.staffId)).toEqual(expect.arrayContaining([f.staff.id, f.secondStaff.id]));
    expect(response.body.data.map((x: { staffId: string }) => x.staffId)).not.toContain(f.otherStaff.id);
    const branchReport = await request(app).get("/api/reports/staff-performance?month=6&year=2026").set(auth(managerToken));
    expect(branchReport.status).toBe(200);
    expect(branchReport.body.data.map((x: { staffId: string }) => x.staffId)).not.toContain(outsideBranchStaff.id);

    const firstPage = await request(app).get("/api/reports/staff-performance?month=6&year=2026&page=1&limit=1").set(auth(f.adminToken));
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data).toHaveLength(1);
    expect(firstPage.body.pagination).toMatchObject({ page: 1, limit: 1 });
    expect(firstPage.body.pagination.total).toBeGreaterThanOrEqual(2);

    const capped = await request(app).get("/api/reports/staff-performance?month=6&year=2026&limit=200").set(auth(f.adminToken));
    expect(capped.status).toBe(200);
    expect(capped.body.pagination.limit).toBe(100);
    expect((await request(app).get("/api/reports/staff-performance?month=6&year=2026&page=0").set(auth(f.adminToken))).status).toBe(400);
  });
});
