import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import jwt from "jsonwebtoken";
import request from "supertest";
import { app } from "../app.js";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";

const token = (user: {
  id: string;
  role: string;
  salonId?: string | null;
  branchId?: string | null;
}) =>
  jwt.sign(
    {
      userId: user.id,
      role: user.role,
      ...(user.salonId ? { salonId: user.salonId } : {}),
      ...(user.branchId ? { branchId: user.branchId } : {}),
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "15m" }
  );
const auth = (value: string) => ({ Authorization: `Bearer ${value}` });

const readSheetValues = async (body: Buffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body as never);
  const sheet = workbook.getWorksheet("Report");
  const values: string[] = [];
  sheet?.eachRow((row) =>
    row.eachCell((cell) => values.push(String(cell.value ?? "")))
  );
  return values.join(" | ");
};

const fixture = async () => {
  const stamp = randomUUID();
  const salon = await prisma.salon.create({ data: { name: `Export Salon ${stamp}` } });
  const otherSalon = await prisma.salon.create({ data: { name: `Other Export Salon ${stamp}` } });
  const branch = await prisma.branch.create({ data: { name: `Export Branch ${stamp}`, salonId: salon.id } });
  const secondBranch = await prisma.branch.create({ data: { name: `Second Branch ${stamp}`, salonId: salon.id } });
  const [admin, manager] = await Promise.all([
    prisma.user.create({ data: { name: "Export Admin", email: `admin-${stamp}@test.com`, passwordHash: "x", role: "SALON_ADMIN", salonId: salon.id } }),
    prisma.user.create({ data: { name: "Export Manager", email: `manager-${stamp}@test.com`, passwordHash: "x", role: "BRANCH_MANAGER", salonId: salon.id, branchId: branch.id } }),
  ]);
  await prisma.sale.create({
    data: {
      saleCode: `SALE-${stamp}`,
      salonId: salon.id,
      branchId: branch.id,
      customerName: "Revenue Customer",
      saleDate: new Date("2026-05-10T10:00:00Z"),
      subtotalAmount: 1000,
      totalAmount: 1000,
      paidAmount: 800,
      dueAmount: 200,
    },
  });
  await prisma.expense.createMany({
    data: [
      { salonId: salon.id, branchId: branch.id, title: "May Rent", category: "Rent", amount: 500, expenseDate: new Date("2026-05-12T10:00:00Z") },
      { salonId: salon.id, branchId: branch.id, title: "June Rent", category: "Rent", amount: 600, expenseDate: new Date("2026-06-12T10:00:00Z") },
    ],
  });
  await prisma.product.createMany({
    data: [
      { salonId: salon.id, branchId: branch.id, name: `Own Product ${stamp}`, currentStock: 2, lowStockAlert: 5, costPrice: 10, sellingPrice: 20 },
      { salonId: salon.id, branchId: secondBranch.id, name: `Other Branch Product ${stamp}`, currentStock: 3, lowStockAlert: 5, costPrice: 10, sellingPrice: 20 },
    ],
  });
  await prisma.customer.create({
    data: {
      customerCode: `WALLET-${stamp}`,
      name: "Wallet Customer",
      phone: "9876501234",
      walletBalance: 250,
      outstandingAmount: 0,
      salonId: salon.id,
      branchId: branch.id,
    },
  });
  return {
    salon,
    otherSalon,
    branch,
    secondBranch,
    adminToken: token(admin),
    managerToken: token(manager),
  };
};

describe("Report exports", () => {
  it("exports revenue as PDF and XLSX", async () => {
    const f = await fixture();
    const pdf = await request(app)
      .get("/api/reports/revenue/export?format=pdf")
      .set(auth(f.adminToken));
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.headers["content-disposition"]).toContain(
      "billing-and-payments-report.pdf"
    );
    expect(pdf.body.subarray(0, 4).toString()).toBe("%PDF");

    const xlsx = await request(app)
      .get("/api/reports/revenue/export?format=xlsx")
      .set(auth(f.adminToken))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(xlsx.headers["content-disposition"]).toContain(
      "billing-and-payments-report.xlsx"
    );
    expect(xlsx.body.subarray(0, 2).toString()).toBe("PK");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.body as never);
    const sheet = workbook.getWorksheet("Report");
    expect(sheet?.getCell("A1").alignment.horizontal).toBe("center");
    expect(sheet?.getCell("A1").font.color).toMatchObject({ argb: "FF000000" });
    expect(sheet?.getCell("A1").fill).toMatchObject({
      fgColor: { argb: "FFF2F2F2" },
    });
    expect(String(sheet?.getCell("A2").value)).toContain(
      "Salon: Export Salon"
    );
    expect(String(sheet?.getCell("A2").value)).toContain(
      " | Branch: All branches | Generated:"
    );
    expect(sheet?.getCell("A4").alignment.horizontal).toBe("center");
    expect(sheet?.getCell("A4").font.color).toMatchObject({ argb: "FF000000" });
    expect(sheet?.getCell("A4").fill).toMatchObject({
      fgColor: { argb: "FFE7E6E6" },
    });
  });

  it("uses report-specific filenames and includes customer wallet balances", async () => {
    const f = await fixture();
    const customer = await request(app)
      .get("/api/reports/customer-outstanding/export?format=xlsx")
      .set(auth(f.adminToken))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(customer.headers["content-disposition"]).toContain(
      "customer-report.xlsx"
    );
    const customerValues = await readSheetValues(customer.body);
    expect(customerValues).toContain("Wallet Customer");
    expect(customerValues).toContain("250");

    const appointment = await request(app)
      .get("/api/reports/appointments/export?format=pdf")
      .set(auth(f.adminToken));
    expect(appointment.status).toBe(200);
    expect(appointment.headers["content-disposition"]).toContain(
      "appointment-report.pdf"
    );
  });

  it("applies expense date filters", async () => {
    const f = await fixture();
    const response = await request(app)
      .get("/api/reports/expenses/export?format=xlsx&from=2026-05-01&to=2026-05-31")
      .set(auth(f.adminToken))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    const values = await readSheetValues(response.body);
    expect(values).toContain("May Rent");
    expect(values).not.toContain("June Rent");
  });

  it("enforces manager branch scope and ignores another salon for salon admin", async () => {
    const f = await fixture();
    const manager = await request(app)
      .get(`/api/reports/inventory/export?format=xlsx&branchId=${f.secondBranch.id}`)
      .set(auth(f.managerToken))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    const managerValues = await readSheetValues(manager.body);
    expect(managerValues).toContain("Own Product");
    expect(managerValues).not.toContain("Other Branch Product");

    const admin = await request(app)
      .get(`/api/reports/inventory/export?format=xlsx&salonId=${f.otherSalon.id}`)
      .set(auth(f.adminToken));
    expect(admin.status).toBe(200);
    expect(admin.headers["content-disposition"]).toContain("export-salon");
  });

  it("rejects invalid formats and audits successful exports", async () => {
    const f = await fixture();
    const invalid = await request(app)
      .get("/api/reports/revenue/export?format=csv")
      .set(auth(f.adminToken));
    expect(invalid.status).toBe(400);

    const exported = await request(app)
      .get("/api/reports/revenue/export?format=pdf")
      .set(auth(f.adminToken));
    expect(exported.status).toBe(200);
    const audit = await prisma.auditLog.findFirst({
      where: {
        salonId: f.salon.id,
        module: "SYSTEM",
        description: { contains: "exported as PDF" },
      },
    });
    expect(audit).not.toBeNull();
    expect(audit?.newData).toMatchObject({
      event: "REPORT_EXPORTED",
      reportType: "revenue",
      format: "pdf",
    });
  });

  it("does not block an export when best-effort audit writing fails", async () => {
    const f = await fixture();
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION fail_report_export_audit()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."description" LIKE '%exported as%' THEN
          RAISE EXCEPTION 'forced export audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_report_export_audit_trigger
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION fail_report_export_audit()
    `);
    try {
      const response = await request(app)
        .get("/api/reports/revenue/export?format=pdf")
        .set(auth(f.adminToken));
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("application/pdf");
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS fail_report_export_audit_trigger ON "AuditLog"`
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS fail_report_export_audit()`
      );
    }
  });

  it("rejects exports above the row limit", async () => {
    const f = await fixture();
    await prisma.$executeRaw`
      INSERT INTO "Customer"
        ("id", "customerCode", "name", "outstandingAmount", "salonId", "createdAt", "updatedAt")
      SELECT
        gen_random_uuid()::text,
        'LIMIT-' || value::text,
        'Limit Customer ' || value::text,
        1,
        ${f.salon.id},
        NOW(),
        NOW()
      FROM generate_series(1, 10001) AS value
    `;
    const response = await request(app)
      .get("/api/reports/customer-outstanding/export?format=pdf")
      .set(auth(f.adminToken));
    expect(response.status).toBe(413);
    expect(response.body.message).toContain("row limit");
  });
});

// The Inventory and Customer pages send no ?branchId=, so the export has to
// follow the admin's open branch session (X-Branch-Id) to match the screen.
describe("Report exports inside an admin branch session", () => {
  const xlsx = (path: string, headers: Record<string, string>) =>
    request(app)
      .get(path)
      .set(headers)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
  const session = (token: string, branchId?: string) => ({
    ...auth(token),
    ...(branchId ? { "X-Branch-Id": branchId } : {}),
  });

  const sessionFixture = async () => {
    const f = await fixture();
    await prisma.customer.create({
      data: {
        customerCode: `SECOND-${randomUUID()}`,
        name: "Second Branch Customer",
        phone: "9876509999",
        salonId: f.salon.id,
        branchId: f.secondBranch.id,
      },
    });
    return f;
  };

  it("exports only the open branch's inventory and customers", async () => {
    const f = await sessionFixture();

    const first = await xlsx(
      "/api/reports/inventory/export?format=xlsx",
      session(f.adminToken, f.branch.id)
    );
    expect(first.status).toBe(200);
    const firstValues = await readSheetValues(first.body);
    expect(firstValues).toContain("Own Product");
    expect(firstValues).not.toContain("Other Branch Product");
    expect(firstValues).toContain(`Branch: ${f.branch.name}`);

    const second = await xlsx(
      "/api/reports/inventory/export?format=xlsx",
      session(f.adminToken, f.secondBranch.id)
    );
    const secondValues = await readSheetValues(second.body);
    expect(secondValues).toContain("Other Branch Product");
    expect(secondValues).not.toContain("Own Product");

    const customers = await xlsx(
      "/api/reports/customer-outstanding/export?format=xlsx",
      session(f.adminToken, f.secondBranch.id)
    );
    const customerValues = await readSheetValues(customers.body);
    expect(customerValues).toContain("Second Branch Customer");
    expect(customerValues).not.toContain("Wallet Customer");
  });

  it("lets the branch session win over a stale ?branchId=", async () => {
    const f = await sessionFixture();
    const res = await xlsx(
      `/api/reports/inventory/export?format=xlsx&branchId=${f.branch.id}`,
      session(f.adminToken, f.secondBranch.id)
    );
    const values = await readSheetValues(res.body);
    expect(values).toContain("Other Branch Product");
    expect(values).not.toContain("Own Product");
  });

  it("keeps the salon-wide export under All Branches", async () => {
    const f = await sessionFixture();
    const inventory = await readSheetValues(
      (await xlsx("/api/reports/inventory/export?format=xlsx", session(f.adminToken))).body
    );
    expect(inventory).toContain("Own Product");
    expect(inventory).toContain("Other Branch Product");

    const customers = await readSheetValues(
      (await xlsx("/api/reports/customer-outstanding/export?format=xlsx", session(f.adminToken))).body
    );
    expect(customers).toContain("Wallet Customer");
    expect(customers).toContain("Second Branch Customer");
  });

  it("rejects a branch from another salon", async () => {
    const f = await sessionFixture();
    const foreign = await prisma.branch.create({
      data: { name: `Foreign ${randomUUID()}`, salonId: f.otherSalon.id },
    });

    const viaHeader = await request(app)
      .get("/api/reports/inventory/export?format=xlsx")
      .set(session(f.adminToken, foreign.id));
    expect(viaHeader.status).toBe(403);

    const viaQuery = await request(app)
      .get(`/api/reports/inventory/export?format=xlsx&branchId=${foreign.id}`)
      .set(session(f.adminToken));
    expect(viaQuery.status).toBe(403);
  });
});
