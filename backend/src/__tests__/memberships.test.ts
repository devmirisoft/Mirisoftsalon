import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";

import { app } from "../app.js";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";

type Actor = {
  id: string;
  role: string;
  salonId?: string | null;
  branchId?: string | null;
};

const auth = (token: string) => ({
  Authorization: `Bearer ${token}`,
});

const tokenFor = (actor: Actor) =>
  jwt.sign(
    {
      userId: actor.id,
      role: actor.role,
      ...(actor.salonId ? { salonId: actor.salonId } : {}),
      ...(actor.branchId ? { branchId: actor.branchId } : {}),
    },
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: "15m",
    }
  );

describe("Memberships and customer membership assignment", () => {
  let salonAId: string;
  let salonBId: string;
  let branchAId: string;
  let customerAId: string;
  let customerAOtherBranchId: string;
  let superAdminToken: string;
  let salonAdminToken: string;
  let branchManagerToken: string;
  let receptionistToken: string;
  let staffToken: string;

  beforeEach(async () => {
    const stamp = randomUUID();
    const salonA = await prisma.salon.create({
      data: {
        name: `Membership Salon A ${stamp}`,
      },
    });
    const salonB = await prisma.salon.create({
      data: {
        name: `Membership Salon B ${stamp}`,
      },
    });
    const branchA = await prisma.branch.create({
      data: {
        name: `Membership Branch A ${stamp}`,
        salonId: salonA.id,
      },
    });
    const branchAOther = await prisma.branch.create({
      data: {
        name: `Membership Branch A Other ${stamp}`,
        salonId: salonA.id,
      },
    });

    salonAId = salonA.id;
    salonBId = salonB.id;
    branchAId = branchA.id;

    const [superAdmin, salonAdmin, branchManager, receptionist, staff] =
      await Promise.all([
        prisma.user.create({
          data: {
            name: "Membership Super Admin",
            email: `membership-super-${stamp}@example.com`,
            passwordHash: "test-only",
            role: "SUPER_ADMIN",
          },
        }),
        prisma.user.create({
          data: {
            name: "Membership Salon Admin",
            email: `membership-admin-${stamp}@example.com`,
            passwordHash: "test-only",
            role: "SALON_ADMIN",
            salonId: salonA.id,
          },
        }),
        prisma.user.create({
          data: {
            name: "Membership Branch Manager",
            email: `membership-manager-${stamp}@example.com`,
            passwordHash: "test-only",
            role: "BRANCH_MANAGER",
            salonId: salonA.id,
            branchId: branchA.id,
          },
        }),
        prisma.user.create({
          data: {
            name: "Membership Receptionist",
            email: `membership-reception-${stamp}@example.com`,
            passwordHash: "test-only",
            role: "RECEPTIONIST",
            salonId: salonA.id,
            branchId: branchA.id,
          },
        }),
        prisma.user.create({
          data: {
            name: "Membership Staff",
            email: `membership-staff-${stamp}@example.com`,
            passwordHash: "test-only",
            role: "STAFF",
            salonId: salonA.id,
            branchId: branchA.id,
          },
        }),
      ]);

    const [customerA, customerAOtherBranch] = await Promise.all([
      prisma.customer.create({
        data: {
          customerCode: `MEM-A-${stamp}`,
          name: "Membership Customer A",
          phone: `A-${stamp}`,
          salonId: salonA.id,
          branchId: branchA.id,
        },
      }),
      prisma.customer.create({
        data: {
          customerCode: `MEM-OTHER-${stamp}`,
          name: "Membership Customer Other Branch",
          phone: `OTHER-${stamp}`,
          salonId: salonA.id,
          branchId: branchAOther.id,
        },
      }),
    ]);

    customerAId = customerA.id;
    customerAOtherBranchId = customerAOtherBranch.id;
    superAdminToken = tokenFor(superAdmin);
    salonAdminToken = tokenFor(salonAdmin);
    branchManagerToken = tokenFor(branchManager);
    receptionistToken = tokenFor(receptionist);
    staffToken = tokenFor(staff);
  });

  it("creates a membership in the salon admin's own salon", async () => {
    const response = await request(app)
      .post("/api/memberships")
      .set(auth(salonAdminToken))
      .send({
        salonId: salonBId,
        name: "Gold",
        description: "Gold membership",
        // Ignored: memberships no longer carry a discount.
        discountPercentage: 12.5,
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      salonId: salonAId,
      name: "Gold",
      description: "Gold membership",
      status: true,
    });
    expect(Number(response.body.data.discountPercentage)).toBe(0);
    expect(await prisma.auditLog.count({ where: { module: "MEMBERSHIP", action: "CREATE", entityId: response.body.data.id } })).toBe(1);
  });

  it("rejects a duplicate membership name in the same salon", async () => {
    await prisma.membership.create({
      data: {
        salonId: salonAId,
        name: "Gold",
      },
    });

    const response = await request(app)
      .post("/api/memberships")
      .set(auth(salonAdminToken))
      .send({
        name: " gold ",
      });

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
  });

  it("allows the same membership name in different salons", async () => {
    const first = await request(app)
      .post("/api/memberships")
      .set(auth(superAdminToken))
      .send({
        salonId: salonAId,
        name: "Gold",
      });
    const second = await request(app)
      .post("/api/memberships")
      .set(auth(superAdminToken))
      .send({
        salonId: salonBId,
        name: "Gold",
      });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.salonId).not.toBe(second.body.data.salonId);
  });

  it("assigns an active membership to a customer", async () => {
    const membership = await prisma.membership.create({
      data: {
        salonId: salonAId,
        name: "Silver",
      },
    });

    const response = await request(app)
      .patch(`/api/customers/${customerAId}/membership`)
      .set(auth(salonAdminToken))
      .send({
        membershipId: membership.id,
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: customerAId,
      membershipId: membership.id,
      membership: {
        id: membership.id,
        name: "Silver",
        status: true,
      },
    });
    expect(await prisma.auditLog.count({ where: { module: "MEMBERSHIP", action: "UPDATE", entityId: customerAId } })).toBe(1);
  });

  it("removes a membership from a customer", async () => {
    const membership = await prisma.membership.create({
      data: {
        salonId: salonAId,
        name: "Silver",
      },
    });
    await prisma.customer.update({
      where: {
        id: customerAId,
      },
      data: {
        membershipId: membership.id,
      },
    });

    const response = await request(app)
      .patch(`/api/customers/${customerAId}/membership`)
      .set(auth(salonAdminToken))
      .send({
        membershipId: null,
      });

    expect(response.status).toBe(200);
    expect(response.body.data.membershipId).toBeNull();
    expect(response.body.data.membership).toBeNull();
  });

  it("rejects cross-salon membership assignment", async () => {
    const membership = await prisma.membership.create({
      data: {
        salonId: salonBId,
        name: "Other Salon Gold",
      },
    });

    const response = await request(app)
      .patch(`/api/customers/${customerAId}/membership`)
      .set(auth(salonAdminToken))
      .send({
        membershipId: membership.id,
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(
      await prisma.customer.findUnique({
        where: {
          id: customerAId,
        },
        select: {
          membershipId: true,
        },
      })
    ).toEqual({
      membershipId: null,
    });
  });

  it("rejects inactive membership assignment", async () => {
    const membership = await prisma.membership.create({
      data: {
        salonId: salonAId,
        name: "Inactive Gold",
        status: false,
      },
    });

    const response = await request(app)
      .patch(`/api/customers/${customerAId}/membership`)
      .set(auth(salonAdminToken))
      .send({
        membershipId: membership.id,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "Only active memberships can be assigned"
    );
  });

  it("prevents staff from creating or viewing memberships", async () => {
    const createResponse = await request(app)
      .post("/api/memberships")
      .set(auth(staffToken))
      .send({
        name: "Forbidden",
      });
    const viewResponse = await request(app)
      .get("/api/memberships")
      .set(auth(staffToken));

    expect(createResponse.status).toBe(403);
    expect(viewResponse.status).toBe(403);
  });

  it("allows branch managers and receptionists to view salon memberships", async () => {
    await prisma.membership.create({
      data: {
        salonId: salonAId,
        name: "Visible Membership",
      },
    });
    await prisma.membership.create({
      data: {
        salonId: salonBId,
        name: "Hidden Membership",
      },
    });

    for (const token of [branchManagerToken, receptionistToken]) {
      const response = await request(app)
        .get("/api/memberships")
        .set(auth(token));

      expect(response.status).toBe(200);
      expect(
        response.body.data.map((item: { name: string }) => item.name)
      ).toEqual(["Visible Membership"]);
    }
  });

  it("keeps receptionist assignment within existing customer branch access", async () => {
    const membership = await prisma.membership.create({
      data: {
        salonId: salonAId,
        name: "Reception Membership",
      },
    });

    const allowed = await request(app)
      .patch(`/api/customers/${customerAId}/membership`)
      .set(auth(receptionistToken))
      .send({
        membershipId: membership.id,
      });
    const hidden = await request(app)
      .patch(`/api/customers/${customerAOtherBranchId}/membership`)
      .set(auth(receptionistToken))
      .send({
        membershipId: membership.id,
      });

    expect(allowed.status).toBe(200);
    expect(hidden.status).toBe(404);
  });

  it("deactivates a linked membership instead of deleting it", async () => {
    const membership = await prisma.membership.create({
      data: {
        salonId: salonAId,
        name: "Linked Membership",
      },
    });
    await prisma.customer.update({
      where: {
        id: customerAId,
      },
      data: {
        membershipId: membership.id,
      },
    });

    const response = await request(app)
      .delete(`/api/memberships/${membership.id}`)
      .set(auth(salonAdminToken));

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe(false);
    expect(
      await prisma.membership.findUnique({
        where: {
          id: membership.id,
        },
        select: {
          status: true,
        },
      })
    ).toEqual({
      status: false,
    });
  });

  it("hard deletes an unlinked membership", async () => {
    const membership = await prisma.membership.create({
      data: {
        salonId: salonAId,
        name: "Disposable Membership",
      },
    });

    const response = await request(app)
      .delete(`/api/memberships/${membership.id}`)
      .set(auth(salonAdminToken));

    expect(response.status).toBe(200);
    expect(
      await prisma.membership.findUnique({
        where: {
          id: membership.id,
        },
      })
    ).toBeNull();
  });
});
