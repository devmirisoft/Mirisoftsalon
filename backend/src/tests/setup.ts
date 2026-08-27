import { prisma } from "../config/prisma.js";

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "SalonAssistantConversation"
    ADD COLUMN IF NOT EXISTS "stateJson" JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS "stateVersion" INTEGER NOT NULL DEFAULT 1
  `);

  // Some suites install triggers on "AuditLog" to force audit writes to fail.
  // They drop them in their own teardown, but a run that crashes or is
  // interrupted leaves them behind, and a stray trigger then breaks every
  // later run by failing audit writes it was never meant to touch. Clearing
  // them here makes a fresh run recover on its own.
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS force_audit_failure ON "AuditLog"`
  );
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS fail_report_export_audit_trigger ON "AuditLog"`
  );
});

const TRUNCATE_SQL = `
    TRUNCATE TABLE
      "AuditLog",
      "SupportTicketStatusHistory",
      "SupportTicketMessage",
      "SupportTicket",
      "UserSession",
      "Payment",
      "InvoiceItem",
      "Invoice",
      "SalePayment",
      "SaleItem",
      "Sale",
      "CustomerTransaction",
      "AppointmentStatusHistory",
      "AppointmentService",
      "Appointment",
      "ServiceConsumable",
      "StaffAttendance",
      "StaffLeave",
      "SalarySlip",
      "StaffSalaryConfig",
      "Service",
      "MainService",
      "Staff",
      "Customer",
      "User",
      "Branch",
      "Salon"
    RESTART IDENTITY CASCADE
`;

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * TRUNCATE needs an ACCESS EXCLUSIVE lock on every table it touches, and the
 * client runs on a pool of several connections. Requests from the test that
 * just finished can still be settling on other connections, so Postgres
 * occasionally reports a deadlock (40P01) instead of simply waiting. That
 * surfaced as this suite failing a different, arbitrary subset of its tests on
 * each run. Retrying resolves it: the losing side is rolled back, and by the
 * next attempt the other connections have finished.
 */
const truncateAll = async (attempts = 5) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await prisma.$executeRawUnsafe(TRUNCATE_SQL);
      return;
    } catch (error) {
      const code = (error as { code?: string }).code;
      const deadlocked =
        code === "40P01" ||
        (error instanceof Error && /deadlock detected/i.test(error.message));
      if (!deadlocked || attempt >= attempts) throw error;
      await sleep(50 * attempt);
    }
  }
};

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await prisma.$disconnect();
});
