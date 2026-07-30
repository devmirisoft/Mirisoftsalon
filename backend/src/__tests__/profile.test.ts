import request from "supertest";
import { randomUUID } from "node:crypto";

import { app } from "../app.js";
import { prisma } from "../config/prisma.js";
import { generateAccessToken } from "../utils/jwt.js";

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const makeUser = async (
  role: "SUPER_ADMIN" | "SALON_ADMIN" | "BRANCH_MANAGER" | "RECEPTIONIST" | "STAFF",
  salonId?: string,
  branchId?: string,
  name = role
) => {
  const user = await prisma.user.create({
    data: {
      name,
      email: `${randomUUID()}@profile.test`,
      passwordHash: "unused",
      role,
      ...(salonId ? { salonId } : {}),
      ...(branchId ? { branchId } : {}),
    },
  });
  return {
    user,
    token: generateAccessToken({
      userId: user.id,
      role: user.role,
      ...(user.salonId ? { salonId: user.salonId } : {}),
      ...(user.branchId ? { branchId: user.branchId } : {}),
    }),
  };
};

const fixture = async () => {
  const salon = await prisma.salon.create({
    data: {
      name: `Profile Salon ${randomUUID()}`,
      gstEnabled: true,
      gstNumber: "27ABCDE1234F1Z5",
      gstLegalName: "Profile Salon Pvt Ltd",
      gstStateCode: "27",
    },
  });
  const branch = await prisma.branch.create({
    data: { name: "Main Branch", salonId: salon.id },
  });
  return { salon, branch };
};

let auditFailureTriggerInstalled = false;

const forceAuditFailure = async () => {
  if (auditFailureTriggerInstalled) return;
  await prisma.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION fail_profile_audit_insert() RETURNS trigger AS $$ BEGIN IF NEW."entityName" LIKE 'FORCE_AUDIT_FAILURE%' THEN RAISE EXCEPTION 'forced profile audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`
  );
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS force_profile_audit_failure ON "AuditLog"`);
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER force_profile_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fail_profile_audit_insert()`
  );
  auditFailureTriggerInstalled = true;
};

const removeAuditFailureTrigger = async () => {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS force_profile_audit_failure ON "AuditLog"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_profile_audit_insert()`);
  auditFailureTriggerInstalled = false;
};

beforeAll(removeAuditFailureTrigger);
afterAll(removeAuditFailureTrigger);

describe("profile routes", () => {
  it("lets users view and update their safe profile fields only", async () => {
    const { salon, branch } = await fixture();
    const { user, token } = await makeUser("SALON_ADMIN", salon.id, branch.id, "Profile Admin");

    const view = await request(app).get("/api/profile").set(auth(token)).expect(200);
    expect(view.body.data.email).toBe(user.email);
    expect(view.body.data.currentSalon.name).toBe(salon.name);
    expect(JSON.stringify(view.body)).not.toMatch(/passwordHash|refreshToken|session/i);

    const updated = await request(app)
      .put("/api/profile")
      .set(auth(token))
      .send({
        fullName: "Updated Admin",
        phone: "9876543210",
        role: "SUPER_ADMIN",
        salonId: randomUUID(),
        branchId: randomUUID(),
      })
      .expect(200);
    expect(updated.body.data.fullName).toBe("Updated Admin");
    expect(updated.body.data.phone).toBe("9876543210");
    expect(updated.body.data.role).toBe("SALON_ADMIN");
    expect(updated.body.data.salonId).toBe(salon.id);
    expect(updated.body.data.branchId).toBe(branch.id);

    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved.role).toBe("SALON_ADMIN");
    expect(saved.salonId).toBe(salon.id);
    expect(await prisma.auditLog.count({ where: { entityId: user.id, description: "Personal profile updated" } })).toBe(1);
  });

  it("enforces salon profile tenant and role permissions", async () => {
    const a = await fixture();
    const b = await fixture();
    const admin = await makeUser("SALON_ADMIN", a.salon.id, a.branch.id);
    const receptionist = await makeUser("RECEPTIONIST", a.salon.id, a.branch.id);
    const staff = await makeUser("STAFF", a.salon.id, a.branch.id);

    await request(app)
      .put(`/api/salon-profile?salonId=${b.salon.id}`)
      .set(auth(admin.token))
      .send({ name: "Own Salon Updated", legalName: "Own Legal", pincode: "110011" })
      .expect(200);
    expect((await prisma.salon.findUniqueOrThrow({ where: { id: a.salon.id } })).name).toBe("Own Salon Updated");
    expect((await prisma.salon.findUniqueOrThrow({ where: { id: b.salon.id } })).name).toBe(b.salon.name);

    await request(app).put("/api/salon-profile").set(auth(receptionist.token)).send({ name: "No" }).expect(403);
    await request(app).put("/api/salon-profile").set(auth(staff.token)).send({ name: "No" }).expect(403);
  });

  it("enforces branch manager own-branch updates", async () => {
    const { salon, branch } = await fixture();
    const otherBranch = await prisma.branch.create({
      data: { name: "Other Branch", salonId: salon.id },
    });
    const manager = await makeUser("BRANCH_MANAGER", salon.id, branch.id);
    const staff = await makeUser("STAFF", salon.id, branch.id);

    const updated = await request(app)
      .put("/api/branch-profile")
      .set(auth(manager.token))
      .send({ name: "Manager Branch", branchId: otherBranch.id })
      .expect(200);
    expect(updated.body.data.id).toBe(branch.id);
    expect((await prisma.branch.findUniqueOrThrow({ where: { id: otherBranch.id } })).name).toBe("Other Branch");

    await request(app).put("/api/branch-profile").set(auth(staff.token)).send({ name: "No" }).expect(403);
  });

  it("validates GST settings and keeps issued invoice snapshots unchanged", async () => {
    const { salon, branch } = await fixture();
    const admin = await makeUser("SALON_ADMIN", salon.id, branch.id);
    const customer = await prisma.customer.create({
      data: { customerCode: `C-${randomUUID()}`, name: "GST Customer", salonId: salon.id },
    });
    const invoice = await prisma.invoice.create({
      data: {
        invoiceCode: `INV-${randomUUID()}`,
        salonId: salon.id,
        branchId: branch.id,
        customerId: customer.id,
        salonName: salon.name,
        customerName: customer.name,
        subtotalAmount: 100,
        totalAmount: 105,
        balanceAmount: 105,
        status: "ISSUED",
        paymentStatus: "UNPAID",
        gstEnabledSnapshot: true,
        gstNumberSnapshot: "27ABCDE1234F1Z5",
        serviceGstAmount: 5,
        totalGstAmount: 5,
      },
    });

    await request(app)
      .put("/api/salon-profile/gst")
      .set(auth(admin.token))
      .send({ gstEnabled: true, gstNumber: "bad" })
      .expect(400);
    await request(app)
      .put("/api/salon-profile/gst")
      .set(auth(admin.token))
      .send({ serviceGstRate: -1 })
      .expect(400);
    await request(app)
      .put("/api/salon-profile/gst")
      .set(auth(admin.token))
      .send({ productGstRate: 101 })
      .expect(400);

    const updated = await request(app)
      .put("/api/salon-profile/gst")
      .set(auth(admin.token))
      .send({
        gstEnabled: true,
        gstNumber: "27abcde1234f1z5",
        gstLegalName: "Updated Legal",
        gstStateCode: "27",
        serviceGstRate: "6.00",
        productGstRate: "12.00",
      })
      .expect(200);
    expect(updated.body.data.gstNumber).toBe("27ABCDE1234F1Z5");
    expect(updated.body.data.gstVerified).toBe(false);

    const issued = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(issued.gstNumberSnapshot).toBe("27ABCDE1234F1Z5");
    expect(Number(issued.totalGstAmount)).toBe(5);
    expect(await prisma.auditLog.count({ where: { module: "GST", entityId: salon.id } })).toBe(1);
  });

  it("rolls back profile updates when transactional audit creation fails", async () => {
    const { salon, branch } = await fixture();
    const admin = await makeUser("SALON_ADMIN", salon.id, branch.id, "Rollback Profile");
    await forceAuditFailure();
    await request(app)
      .put("/api/profile")
      .set(auth(admin.token))
      .send({ fullName: "FORCE_AUDIT_FAILURE Profile" })
      .expect(500);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })).name).toBe("Rollback Profile");
  });

  it("blocks cross-tenant branch access", async () => {
    const a = await fixture();
    const b = await fixture();
    const superAdmin = await makeUser("SUPER_ADMIN");
    const salonAdmin = await makeUser("SALON_ADMIN", a.salon.id, a.branch.id);

    await request(app)
      .get(`/api/branch-profile?branchId=${b.branch.id}`)
      .set(auth(salonAdmin.token))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.id).toBe(a.branch.id);
      });

    await request(app)
      .get(`/api/branch-profile?branchId=${b.branch.id}&salonId=${a.salon.id}`)
      .set(auth(superAdmin.token))
      .expect(404);
  });
});
