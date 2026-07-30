import { prisma } from "../config/prisma.js";

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "SalonAssistantConversation"
    ADD COLUMN IF NOT EXISTS "stateJson" JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS "stateVersion" INTEGER NOT NULL DEFAULT 1
  `);
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
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
  `);
});

afterAll(async () => {
  await prisma.$disconnect();
});
