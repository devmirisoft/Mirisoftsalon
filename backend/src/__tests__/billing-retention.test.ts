import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";

import { app } from "../app.js";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";

const auth = (token: string) => ({
  Authorization: `Bearer ${token}`,
});

const tokenFor = (user: {
  id: string;
  role: string;
  salonId?: string | null;
}) =>
  jwt.sign(
    {
      userId: user.id,
      role: user.role,
      ...(user.salonId ? { salonId: user.salonId } : {}),
    },
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: "15m",
    }
  );

const createBillingFixture = async (options?: {
  membershipDiscount?: number;
  membershipStatus?: boolean;
  loyaltyPoints?: number;
  servicePrice?: number;
}) => {
  const stamp = randomUUID();
  const salon = await prisma.salon.create({
    data: {
      name: `Retention Salon ${stamp}`,
    },
  });
  const branch = await prisma.branch.create({
    data: {
      name: `Retention Branch ${stamp}`,
      salonId: salon.id,
    },
  });
  const admin = await prisma.user.create({
    data: {
      name: "Retention Salon Admin",
      email: `retention-admin-${stamp}@example.com`,
      passwordHash: "test-only",
      role: "SALON_ADMIN",
      salonId: salon.id,
    },
  });
  const membership =
    options?.membershipDiscount === undefined
      ? null
      : await prisma.membership.create({
          data: {
            salonId: salon.id,
            name: `Retention Membership ${stamp}`,
            discountPercentage: options.membershipDiscount,
            status: options.membershipStatus ?? true,
          },
        });
  const customer = await prisma.customer.create({
    data: {
      customerCode: `RET-${stamp}`,
      name: "Retention Customer",
      phone: `RET-${stamp}`,
      salonId: salon.id,
      branchId: branch.id,
      loyaltyPoints: options?.loyaltyPoints ?? 0,
      ...(membership ? { membershipId: membership.id } : {}),
    },
  });
  const staff = await prisma.staff.create({
    data: {
      name: "Retention Staff",
      email: `retention-staff-${stamp}@example.com`,
      jobRole: "Stylist",
      workingFrom: "10:00",
      workingTo: "19:00",
      weekOff: "MONDAY",
      salonId: salon.id,
      branchId: branch.id,
    },
  });
  const mainService = await prisma.mainService.create({
    data: {
      name: `Retention Main Service ${stamp}`,
      salonId: salon.id,
    },
  });
  const servicePrice = options?.servicePrice ?? 1000;
  const service = await prisma.service.create({
    data: {
      name: `Retention Service ${stamp}`,
      price: servicePrice,
      durationValue: 60,
      salonId: salon.id,
      branchId: branch.id,
      mainServiceId: mainService.id,
    },
  });
  const appointment = await prisma.appointment.create({
    data: {
      appointmentCode: `RET-APT-${stamp}`,
      salonId: salon.id,
      branchId: branch.id,
      customerId: customer.id,
      staffId: staff.id,
      createdById: admin.id,
      startTime: new Date("2035-01-01T10:00:00.000Z"),
      endTime: new Date("2035-01-01T11:00:00.000Z"),
      totalDurationMinutes: 60,
      estimatedAmount: servicePrice,
      status: "COMPLETED",
      services: {
        create: {
          serviceId: service.id,
          serviceName: service.name,
          price: servicePrice,
          durationValue: 60,
          durationUnit: "MINUTES",
        },
      },
    },
  });

  return {
    salon,
    branch,
    admin,
    adminToken: tokenFor(admin),
    membership,
    customer,
    appointment,
  };
};

const createInvoice = (
  fixture: Awaited<ReturnType<typeof createBillingFixture>>,
  body: Record<string, unknown> = {}
) =>
  request(app)
    .post(`/api/invoices/from-appointment/${fixture.appointment.id}`)
    .set(auth(fixture.adminToken))
    .send({
      invoiceType: "BILL_OF_SUPPLY",
      ...body,
    });

describe("Membership discounts and invoice loyalty integration", () => {
  it("never discounts a bill for an active membership", async () => {
    const fixture = await createBillingFixture({
      membershipDiscount: 10,
    });
    const invoice = await createInvoice(fixture);

    expect(invoice.status).toBe(201);
    expect(Number(invoice.body.data.subtotalAmount)).toBe(1000);
    expect(Number(invoice.body.data.membershipDiscountAmount)).toBe(0);
    expect(Number(invoice.body.data.discountAmount)).toBe(0);
    expect(Number(invoice.body.data.totalAmount)).toBe(1000);
    expect(Number(invoice.body.data.balanceAmount)).toBe(1000);
  });

  it("does not apply an inactive membership discount", async () => {
    const fixture = await createBillingFixture({
      membershipDiscount: 10,
      membershipStatus: false,
    });
    const invoice = await createInvoice(fixture);

    expect(invoice.status).toBe(201);
    expect(Number(invoice.body.data.membershipDiscountAmount)).toBe(0);
    expect(Number(invoice.body.data.discountAmount)).toBe(0);
    expect(Number(invoice.body.data.totalAmount)).toBe(1000);
  });

  it("applies only the manual discount for a member", async () => {
    const fixture = await createBillingFixture({
      membershipDiscount: 20,
    });
    const invoice = await createInvoice(fixture, {
      discountAmount: 950,
    });

    expect(invoice.status).toBe(201);
    expect(Number(invoice.body.data.manualDiscountAmount)).toBe(950);
    expect(Number(invoice.body.data.membershipDiscountAmount)).toBe(0);
    expect(Number(invoice.body.data.discountAmount)).toBe(950);
    expect(Number(invoice.body.data.totalAmount)).toBe(50);
    expect(Number(invoice.body.data.balanceAmount)).toBe(50);
  });

  it("awards points when an invoice becomes paid", async () => {
    const fixture = await createBillingFixture();
    await prisma.loyaltyRule.create({
      data: {
        salonId: fixture.salon.id,
        earnAmountStep: 100,
        earnPointsPerAmount: 1,
        status: true,
      },
    });
    const invoice = await createInvoice(fixture);
    expect(invoice.status).toBe(201);

    const payment = await request(app)
      .post("/api/payments")
      .set(auth(fixture.adminToken))
      .send({
        invoiceId: invoice.body.data.id,
        amount: 1000,
        method: "CASH",
      });

    expect(payment.status).toBe(201);
    expect(payment.body.data.invoice.paymentStatus).toBe("PAID");
    expect(payment.body.data.loyalty.pointsEarned).toBe(10);
    expect(
      await prisma.customer.findUnique({
        where: {
          id: fixture.customer.id,
        },
        select: {
          loyaltyPoints: true,
        },
      })
    ).toEqual({
      loyaltyPoints: 10,
    });
    expect(
      await prisma.loyaltyTransaction.findFirst({
        where: {
          customerId: fixture.customer.id,
          type: "EARNED",
        },
      })
    ).toMatchObject({
      points: 10,
      balanceBefore: 0,
      balanceAfter: 10,
      referenceType: "INVOICE",
      referenceId: invoice.body.data.id,
    });
    expect(await prisma.auditLog.count({ where: { module: "LOYALTY", action: "CREATE", entityCode: invoice.body.data.id } })).toBe(1);
  });

  it("does not earn points twice for the same invoice", async () => {
    const fixture = await createBillingFixture();
    await prisma.loyaltyRule.create({
      data: {
        salonId: fixture.salon.id,
        status: true,
      },
    });
    const invoice = await createInvoice(fixture);

    await request(app)
      .post("/api/payments")
      .set(auth(fixture.adminToken))
      .send({
        invoiceId: invoice.body.data.id,
        amount: 1000,
        method: "CASH",
      })
      .expect(201);

    const duplicatePayment = await request(app)
      .post("/api/payments")
      .set(auth(fixture.adminToken))
      .send({
        invoiceId: invoice.body.data.id,
        amount: 1,
        method: "CASH",
      });

    expect(duplicatePayment.status).toBe(400);
    expect(
      await prisma.loyaltyTransaction.count({
        where: {
          referenceType: "INVOICE",
          referenceId: invoice.body.data.id,
          type: "EARNED",
        },
      })
    ).toBe(1);
  });

  it("redeems points and lowers customer points and invoice balance", async () => {
    const fixture = await createBillingFixture({
      loyaltyPoints: 500,
    });
    await prisma.loyaltyRule.create({
      data: {
        salonId: fixture.salon.id,
        redeemValuePerPoint: 1,
        minRedeemPoints: 10,
        maxRedeemPoints: 500,
        status: true,
      },
    });
    const invoice = await createInvoice(fixture);

    const redemption = await request(app)
      .post(`/api/invoices/${invoice.body.data.id}/redeem-loyalty`)
      .set(auth(fixture.adminToken))
      .send({
        points: 100,
      });

    expect(redemption.status).toBe(200);
    expect(redemption.body.data.customer.loyaltyPoints).toBe(400);
    expect(Number(redemption.body.data.invoice.discountAmount)).toBe(100);
    expect(Number(redemption.body.data.invoice.totalAmount)).toBe(900);
    expect(Number(redemption.body.data.invoice.balanceAmount)).toBe(900);
    expect(redemption.body.data.loyaltyTransaction).toMatchObject({
      type: "REDEEMED",
      points: -100,
      balanceBefore: 500,
      balanceAfter: 400,
      referenceType: "INVOICE",
      referenceId: invoice.body.data.id,
    });
    expect(await prisma.auditLog.count({ where: { module: "LOYALTY", action: "UPDATE", entityCode: invoice.body.data.invoiceCode } })).toBe(1);
  });

  it("rejects redemption above the customer's available points", async () => {
    const fixture = await createBillingFixture({
      loyaltyPoints: 50,
    });
    await prisma.loyaltyRule.create({
      data: {
        salonId: fixture.salon.id,
        status: true,
      },
    });
    const invoice = await createInvoice(fixture);

    const redemption = await request(app)
      .post(`/api/invoices/${invoice.body.data.id}/redeem-loyalty`)
      .set(auth(fixture.adminToken))
      .send({
        points: 51,
      });

    expect(redemption.status).toBe(400);
    expect(redemption.body.message).toBe(
      "Customer does not have enough loyalty points"
    );
  });

  it("rejects loyalty discount above the invoice balance", async () => {
    const fixture = await createBillingFixture({
      loyaltyPoints: 1000,
    });
    await prisma.loyaltyRule.create({
      data: {
        salonId: fixture.salon.id,
        redeemValuePerPoint: 2,
        maxRedeemPoints: 1000,
        status: true,
      },
    });
    const invoice = await createInvoice(fixture);

    const redemption = await request(app)
      .post(`/api/invoices/${invoice.body.data.id}/redeem-loyalty`)
      .set(auth(fixture.adminToken))
      .send({
        points: 600,
      });

    expect(redemption.status).toBe(400);
    expect(redemption.body.message).toBe(
      "Loyalty discount cannot exceed invoice balance"
    );
  });

  it("blocks cross-salon invoice redemption", async () => {
    const salonA = await createBillingFixture({
      loyaltyPoints: 500,
    });
    const salonB = await createBillingFixture({
      loyaltyPoints: 500,
    });
    await prisma.loyaltyRule.create({
      data: {
        salonId: salonB.salon.id,
        status: true,
      },
    });
    const invoiceB = await createInvoice(salonB);

    const redemption = await request(app)
      .post(`/api/invoices/${invoiceB.body.data.id}/redeem-loyalty`)
      .set(auth(salonA.adminToken))
      .send({
        points: 100,
      });

    expect(redemption.status).toBe(404);
  });
});
