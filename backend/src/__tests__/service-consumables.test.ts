import { randomUUID } from "node:crypto";
import request from "supertest";

import { app } from "../app.js";
import { prisma } from "../config/prisma.js";
import { generateAccessToken } from "../utils/jwt.js";

const createFixture = async () => {
  const [salon, otherSalon] = await Promise.all([
    prisma.salon.create({ data: { name: `Consumables ${randomUUID()}` } }),
    prisma.salon.create({ data: { name: `Other ${randomUUID()}` } }),
  ]);
  const [branch, otherBranch] = await Promise.all([
    prisma.branch.create({ data: { name: "Main", salonId: salon.id } }),
    prisma.branch.create({
      data: { name: "Other", salonId: otherSalon.id },
    }),
  ]);
  const [admin, otherAdmin] = await Promise.all([
    prisma.user.create({
      data: {
        name: "Consumables Admin",
        email: `consumables-${randomUUID()}@test.com`,
        passwordHash: "not-used",
        role: "SALON_ADMIN",
        salonId: salon.id,
        branchId: branch.id,
      },
    }),
    prisma.user.create({
      data: {
        name: "Other Admin",
        email: `other-${randomUUID()}@test.com`,
        passwordHash: "not-used",
        role: "SALON_ADMIN",
        salonId: otherSalon.id,
        branchId: otherBranch.id,
      },
    }),
  ]);
  const [mainService, otherMainService] = await Promise.all([
    prisma.mainService.create({
      data: { name: "Hair", salonId: salon.id },
    }),
    prisma.mainService.create({
      data: { name: "Other Hair", salonId: otherSalon.id },
    }),
  ]);
  const [service, secondService, otherService] = await Promise.all([
    prisma.service.create({
      data: {
        name: "Hair Color",
        price: 500,
        salonId: salon.id,
        branchId: branch.id,
        mainServiceId: mainService.id,
      },
    }),
    prisma.service.create({
      data: {
        name: "Hair Treatment",
        price: 400,
        salonId: salon.id,
        branchId: branch.id,
        mainServiceId: mainService.id,
      },
    }),
    prisma.service.create({
      data: {
        name: "Other Service",
        price: 300,
        salonId: otherSalon.id,
        branchId: otherBranch.id,
        mainServiceId: otherMainService.id,
      },
    }),
  ]);
  const [product, secondProduct, nonConsumable, otherProduct] =
    await Promise.all([
      prisma.product.create({
        data: {
          name: "Color",
          salonId: salon.id,
          branchId: branch.id,
          unit: "ML",
          currentStock: 20,
          isServiceConsumable: true,
        },
      }),
      prisma.product.create({
        data: {
          name: "Developer",
          salonId: salon.id,
          branchId: branch.id,
          unit: "ML",
          currentStock: 20,
          isServiceConsumable: true,
        },
      }),
      prisma.product.create({
        data: {
          name: "Retail Shampoo",
          salonId: salon.id,
          branchId: branch.id,
          currentStock: 20,
          isServiceConsumable: false,
        },
      }),
      prisma.product.create({
        data: {
          name: "Other Color",
          salonId: otherSalon.id,
          branchId: otherBranch.id,
          currentStock: 20,
          isServiceConsumable: true,
        },
      }),
    ]);
  const [customer, staff] = await Promise.all([
    prisma.customer.create({
      data: {
        customerCode: `CUS-${randomUUID()}`,
        name: "Consumables Customer",
        salonId: salon.id,
        branchId: branch.id,
      },
    }),
    prisma.staff.create({
      data: {
        staffCode: `ST-${randomUUID()}`,
        name: "Consumables Stylist",
        email: `stylist-${randomUUID()}@test.com`,
        salonId: salon.id,
        branchId: branch.id,
        jobRole: "Stylist",
        workingFrom: "09:00",
        workingTo: "18:00",
        weekOff: "Sunday",
      },
    }),
  ]);
  const token = generateAccessToken({
    userId: admin.id,
    role: admin.role,
    salonId: salon.id,
    branchId: branch.id,
  });
  const otherToken = generateAccessToken({
    userId: otherAdmin.id,
    role: otherAdmin.role,
    salonId: otherSalon.id,
    branchId: otherBranch.id,
  });

  return {
    salon,
    otherSalon,
    branch,
    admin,
    service,
    secondService,
    otherService,
    product,
    secondProduct,
    nonConsumable,
    otherProduct,
    customer,
    staff,
    token,
    otherToken,
  };
};

const createAppointment = async (
  fixture: Awaited<ReturnType<typeof createFixture>>,
  serviceIds: string[],
  status: "SCHEDULED" | "CHECKED_IN" = "CHECKED_IN"
) =>
  prisma.appointment.create({
    data: {
      appointmentCode: `APT-${randomUUID()}`,
      salonId: fixture.salon.id,
      branchId: fixture.branch.id,
      customerId: fixture.customer.id,
      staffId: fixture.staff.id,
      startTime: new Date("2035-01-01T10:00:00.000Z"),
      endTime: new Date("2035-01-01T11:00:00.000Z"),
      status,
      services: {
        create: serviceIds.map((serviceId) => ({
          serviceId,
          serviceName:
            serviceId === fixture.service.id
              ? fixture.service.name
              : fixture.secondService.name,
          price: 100,
        })),
      },
    },
  });

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("service consumables", () => {
  it("creates, lists, rejects duplicates, updates, and soft-deletes mappings", async () => {
    const fixture = await createFixture();
    const created = await request(app)
      .post(`/api/services/${fixture.service.id}/consumables`)
      .set(auth(fixture.token))
      .send({ productId: fixture.product.id, quantity: 2.5 });
    expect(created.statusCode).toBe(201);
    expect(Number(created.body.data.quantity)).toBe(2.5);

    const duplicate = await request(app)
      .post(`/api/services/${fixture.service.id}/consumables`)
      .set(auth(fixture.token))
      .send({ productId: fixture.product.id, quantity: 1 });
    expect(duplicate.statusCode).toBe(409);

    const listed = await request(app)
      .get(`/api/services/${fixture.service.id}/consumables`)
      .set(auth(fixture.token));
    expect(listed.statusCode).toBe(200);
    expect(listed.body.data).toHaveLength(1);

    const updated = await request(app)
      .put(`/api/service-consumables/${created.body.data.id}`)
      .set(auth(fixture.token))
      .send({ quantity: 3 });
    expect(updated.statusCode).toBe(200);
    expect(Number(updated.body.data.quantity)).toBe(3);

    const removed = await request(app)
      .delete(`/api/service-consumables/${created.body.data.id}`)
      .set(auth(fixture.token));
    expect(removed.statusCode).toBe(200);
    expect(removed.body.data.status).toBe(false);

    const activeAfterDelete = await request(app)
      .get(`/api/services/${fixture.service.id}/consumables`)
      .set(auth(fixture.token));
    expect(activeAfterDelete.body.data).toHaveLength(0);
  });

  it("rejects cross-salon, non-consumable, and non-positive mappings", async () => {
    const fixture = await createFixture();
    const crossSalon = await request(app)
      .post(`/api/services/${fixture.service.id}/consumables`)
      .set(auth(fixture.token))
      .send({ productId: fixture.otherProduct.id, quantity: 1 });
    expect(crossSalon.statusCode).toBe(404);

    const nonConsumable = await request(app)
      .post(`/api/services/${fixture.service.id}/consumables`)
      .set(auth(fixture.token))
      .send({ productId: fixture.nonConsumable.id, quantity: 1 });
    expect(nonConsumable.statusCode).toBe(400);

    const invalidQuantity = await request(app)
      .post(`/api/services/${fixture.service.id}/consumables`)
      .set(auth(fixture.token))
      .send({ productId: fixture.product.id, quantity: 0 });
    expect(invalidQuantity.statusCode).toBe(400);
  });

  it("deducts consumables and records exact movement balances on completion", async () => {
    const fixture = await createFixture();
    await prisma.serviceConsumable.create({
      data: {
        salonId: fixture.salon.id,
        serviceId: fixture.service.id,
        productId: fixture.product.id,
        quantity: 2.5,
      },
    });
    const appointment = await createAppointment(fixture, [fixture.service.id]);

    const completed = await request(app)
      .patch(`/api/appointments/${appointment.id}/status`)
      .set(auth(fixture.token))
      .send({ status: "COMPLETED" });
    expect(completed.statusCode).toBe(200);

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: fixture.product.id },
    });
    expect(Number(product.currentStock)).toBe(17.5);
    const movement = await prisma.productStockMovement.findFirstOrThrow({
      where: {
        productId: fixture.product.id,
        type: "USED_IN_SERVICE",
        referenceType: "APPOINTMENT",
        referenceId: appointment.id,
      },
    });
    expect(Number(movement.stockBefore)).toBe(20);
    expect(Number(movement.stockAfter)).toBe(17.5);
    expect(Number(movement.quantity)).toBe(2.5);
  });

  it("aggregates shared products across multiple appointment services", async () => {
    const fixture = await createFixture();
    await prisma.serviceConsumable.createMany({
      data: [
        {
          salonId: fixture.salon.id,
          serviceId: fixture.service.id,
          productId: fixture.product.id,
          quantity: 2,
        },
        {
          salonId: fixture.salon.id,
          serviceId: fixture.secondService.id,
          productId: fixture.product.id,
          quantity: 3,
        },
        {
          salonId: fixture.salon.id,
          serviceId: fixture.secondService.id,
          productId: fixture.secondProduct.id,
          quantity: 4,
        },
      ],
    });
    const appointment = await createAppointment(fixture, [
      fixture.service.id,
      fixture.secondService.id,
    ]);

    await request(app)
      .patch(`/api/appointments/${appointment.id}/status`)
      .set(auth(fixture.token))
      .send({ status: "COMPLETED" })
      .expect(200);

    const [first, second, movements] = await Promise.all([
      prisma.product.findUniqueOrThrow({ where: { id: fixture.product.id } }),
      prisma.product.findUniqueOrThrow({
        where: { id: fixture.secondProduct.id },
      }),
      prisma.productStockMovement.findMany({
        where: { referenceId: appointment.id, type: "USED_IN_SERVICE" },
      }),
    ]);
    expect(Number(first.currentStock)).toBe(15);
    expect(Number(second.currentStock)).toBe(16);
    // One movement per service line and product, so each use is traceable to
    // the service that made it; the product total is unchanged.
    expect(movements).toHaveLength(3);
    expect(movements.every((row) => row.appointmentServiceId)).toBe(true);
    expect(
      movements
        .filter((row) => row.productId === fixture.product.id)
        .reduce((sum, row) => sum + Number(row.quantity), 0)
    ).toBe(5);
  });

  it("does not double-deduct when completion is requested twice", async () => {
    const fixture = await createFixture();
    await prisma.serviceConsumable.create({
      data: {
        salonId: fixture.salon.id,
        serviceId: fixture.service.id,
        productId: fixture.product.id,
        quantity: 2,
      },
    });
    const appointment = await createAppointment(fixture, [fixture.service.id]);

    await request(app)
      .patch(`/api/appointments/${appointment.id}/status`)
      .set(auth(fixture.token))
      .send({ status: "COMPLETED" })
      .expect(200);
    await request(app)
      .patch(`/api/appointments/${appointment.id}/status`)
      .set(auth(fixture.token))
      .send({ status: "COMPLETED" })
      .expect(400);

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: fixture.product.id },
    });
    expect(Number(product.currentStock)).toBe(18);
    expect(
      await prisma.productStockMovement.count({
        where: { referenceId: appointment.id, type: "USED_IN_SERVICE" },
      })
    ).toBe(1);
  });

  it("restores completed appointment consumables once on cancellation", async () => {
    const fixture = await createFixture();
    await prisma.serviceConsumable.create({
      data: {
        salonId: fixture.salon.id,
        serviceId: fixture.service.id,
        productId: fixture.product.id,
        quantity: 2,
      },
    });
    const appointment = await createAppointment(fixture, [fixture.service.id]);

    await request(app)
      .patch(`/api/appointments/${appointment.id}/status`)
      .set(auth(fixture.token))
      .send({ status: "COMPLETED" })
      .expect(200);
    await request(app)
      .patch(`/api/appointments/${appointment.id}/status`)
      .set(auth(fixture.token))
      .send({ status: "CANCELLED" })
      .expect(200);
    await request(app)
      .patch(`/api/appointments/${appointment.id}/status`)
      .set(auth(fixture.token))
      .send({ status: "CANCELLED" })
      .expect(400);

    const [product, appointmentAfter, reversals] = await Promise.all([
      prisma.product.findUniqueOrThrow({ where: { id: fixture.product.id } }),
      prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } }),
      prisma.productStockMovement.findMany({
        where: {
          productId: fixture.product.id,
          type: "RETURNED",
          referenceType: "APPOINTMENT_CONSUMABLE_REVERSAL",
          referenceId: appointment.id,
        },
      }),
    ]);
    expect(Number(product.currentStock)).toBe(20);
    expect(appointmentAfter.status).toBe("CANCELLED");
    expect(reversals).toHaveLength(1);
    expect(Number(reversals[0]!.quantity)).toBe(2);
  });

  it("rolls back every deduction, status, and history when stock is insufficient", async () => {
    const fixture = await createFixture();
    await prisma.product.update({
      where: { id: fixture.secondProduct.id },
      data: { currentStock: 1 },
    });
    await prisma.serviceConsumable.createMany({
      data: [
        {
          salonId: fixture.salon.id,
          serviceId: fixture.service.id,
          productId: fixture.product.id,
          quantity: 2,
        },
        {
          salonId: fixture.salon.id,
          serviceId: fixture.service.id,
          productId: fixture.secondProduct.id,
          quantity: 5,
        },
      ],
    });
    const appointment = await createAppointment(fixture, [fixture.service.id]);

    const response = await request(app)
      .patch(`/api/appointments/${appointment.id}/status`)
      .set(auth(fixture.token))
      .send({ status: "COMPLETED" });
    expect(response.statusCode).toBe(400);
    expect(response.body.message).toBe(
      "Insufficient stock for service consumables"
    );

    const [appointmentAfter, first, second, movements, history] =
      await Promise.all([
        prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } }),
        prisma.product.findUniqueOrThrow({ where: { id: fixture.product.id } }),
        prisma.product.findUniqueOrThrow({
          where: { id: fixture.secondProduct.id },
        }),
        prisma.productStockMovement.count({
          where: { referenceId: appointment.id, type: "USED_IN_SERVICE" },
        }),
        prisma.appointmentStatusHistory.count({
          where: { appointmentId: appointment.id },
        }),
      ]);
    expect(appointmentAfter.status).toBe("CHECKED_IN");
    expect(Number(first.currentStock)).toBe(20);
    expect(Number(second.currentStock)).toBe(1);
    expect(movements).toBe(0);
    expect(history).toBe(0);
  });

  it("does not deduct for cancelled or no-show appointments", async () => {
    const fixture = await createFixture();
    await prisma.serviceConsumable.create({
      data: {
        salonId: fixture.salon.id,
        serviceId: fixture.service.id,
        productId: fixture.product.id,
        quantity: 2,
      },
    });
    const cancelled = await createAppointment(
      fixture,
      [fixture.service.id],
      "SCHEDULED"
    );
    const noShow = await createAppointment(
      fixture,
      [fixture.service.id],
      "SCHEDULED"
    );

    await request(app)
      .patch(`/api/appointments/${cancelled.id}/status`)
      .set(auth(fixture.token))
      .send({ status: "CANCELLED" })
      .expect(200);
    await request(app)
      .patch(`/api/appointments/${noShow.id}/status`)
      .set(auth(fixture.token))
      .send({ status: "NO_SHOW" })
      .expect(200);

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: fixture.product.id },
    });
    expect(Number(product.currentStock)).toBe(20);
    expect(
      await prisma.productStockMovement.count({
        where: { type: "USED_IN_SERVICE" },
      })
    ).toBe(0);
  });

  it("prevents another salon from completing the appointment", async () => {
    const fixture = await createFixture();
    const appointment = await createAppointment(fixture, [fixture.service.id]);

    const response = await request(app)
      .patch(`/api/appointments/${appointment.id}/status`)
      .set(auth(fixture.otherToken))
      .send({ status: "COMPLETED" });
    expect(response.statusCode).toBe(404);
    expect(
      (
        await prisma.appointment.findUniqueOrThrow({
          where: { id: appointment.id },
        })
      ).status
    ).toBe("CHECKED_IN");
  });
});
