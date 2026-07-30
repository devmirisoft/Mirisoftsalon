import jwt from "jsonwebtoken";
import request from "supertest";

import { app } from "../app.js";
import { prisma } from "../config/prisma.js";
import { generateAccessToken } from "../utils/jwt.js";

const auth = (token: string) => ({
  Authorization: `Bearer ${token}`,
});

const expectSuccess = (res: request.Response, status: number) => {
  if (res.status !== status) {
    throw new Error(
      `Expected ${status}, received ${res.status}: ${JSON.stringify(res.body)}`
    );
  }

  expect(res.body.success).toBe(true);
};

const expectFailure = (res: request.Response, status: number) => {
  if (res.status !== status) {
    throw new Error(
      `Expected ${status}, received ${res.status}: ${JSON.stringify(res.body)}`
    );
  }

  expect(res.body.success).toBe(false);
};

describe("Receptionist role", () => {
  it("enforces receptionist RBAC, tenant isolation, and branch isolation", async () => {
    const stamp = Date.now();
    const password = "Password@123";

    const superAdmin = await prisma.user.create({
      data: {
        name: "Receptionist Test Super Admin",
        email: `receptionist-super-${stamp}@example.com`,
        passwordHash: "not-used",
        role: "SUPER_ADMIN",
      },
    });
    const superAdminToken = generateAccessToken({
      userId: superAdmin.id,
      role: superAdmin.role,
    });

    const salonA = await request(app)
      .post("/api/salons")
      .set(auth(superAdminToken))
      .send({ name: `Receptionist Salon A ${stamp}` });
    expectSuccess(salonA, 201);
    const salonAId = salonA.body.data.id as string;

    const branchA = await request(app)
      .post("/api/branches")
      .set(auth(superAdminToken))
      .send({
        name: `Receptionist Branch A ${stamp}`,
        salonId: salonAId,
      });
    expectSuccess(branchA, 201);
    const branchAId = branchA.body.data.id as string;

    const branchC = await request(app)
      .post("/api/branches")
      .set(auth(superAdminToken))
      .send({
        name: `Receptionist Branch C ${stamp}`,
        salonId: salonAId,
      });
    expectSuccess(branchC, 201);
    const branchCId = branchC.body.data.id as string;

    const receptionistEmail = `receptionist-${stamp}@example.com`;
    const createReceptionist = await request(app)
      .post("/api/users/receptionist")
      .set(auth(superAdminToken))
      .send({
        name: "Receptionist A",
        email: receptionistEmail,
        phone_number: `91${String(stamp).slice(-8)}`,
        password,
        salonId: salonAId,
        branchId: branchAId,
      });
    expectSuccess(createReceptionist, 201);
    const receptionistId = createReceptionist.body.data.id as string;

    const login = await request(app).post("/api/auth/login").send({
      email: receptionistEmail,
      password,
    });
    expectSuccess(login, 200);

    const receptionistToken = login.body.data.accessToken as string;
    expect(login.body.data.user).toMatchObject({
      id: receptionistId,
      role: "RECEPTIONIST",
      salonId: salonAId,
      branchId: branchAId,
    });

    const decoded = jwt.decode(receptionistToken);
    expect(decoded).toMatchObject({
      userId: receptionistId,
      role: "RECEPTIONIST",
      salonId: salonAId,
      branchId: branchAId,
    });

    const me = await request(app)
      .get("/api/auth/me")
      .set(auth(receptionistToken));
    expectSuccess(me, 200);
    expect(me.body.user).toMatchObject({
      userId: receptionistId,
      role: "RECEPTIONIST",
      salonId: salonAId,
      branchId: branchAId,
    });

    const staffA = await request(app)
      .post("/api/staff")
      .set(auth(superAdminToken))
      .send({
        name: "Receptionist Staff A",
        email: `receptionist-staff-a-${stamp}@example.com`,
        phone: "9811111111",
        jobRole: "Stylist",
        workingFrom: "10:00",
        workingTo: "19:00",
        weekOff: "MONDAY",
        salonId: salonAId,
        branchId: branchAId,
      });
    expectSuccess(staffA, 201);
    const staffAId = staffA.body.data.id as string;

    const staffC = await request(app)
      .post("/api/staff")
      .set(auth(superAdminToken))
      .send({
        name: "Receptionist Staff C",
        email: `receptionist-staff-c-${stamp}@example.com`,
        phone: "9822222222",
        jobRole: "Stylist",
        workingFrom: "10:00",
        workingTo: "19:00",
        weekOff: "TUESDAY",
        salonId: salonAId,
        branchId: branchCId,
      });
    expectSuccess(staffC, 201);

    const mainServiceA = await request(app)
      .post("/api/main-services")
      .set(auth(superAdminToken))
      .send({
        name: `Receptionist Hair ${stamp}`,
        salonId: salonAId,
      });
    expectSuccess(mainServiceA, 201);
    const mainServiceAId = mainServiceA.body.data.id as string;

    const serviceA = await request(app)
      .post("/api/services")
      .set(auth(superAdminToken))
      .send({
        name: `Receptionist Haircut A ${stamp}`,
        price: 500,
        durationValue: 60,
        durationUnit: "MINUTES",
        salonId: salonAId,
        branchId: branchAId,
        mainServiceId: mainServiceAId,
      });
    expectSuccess(serviceA, 201);
    const serviceAId = serviceA.body.data.id as string;

    const serviceC = await request(app)
      .post("/api/services")
      .set(auth(superAdminToken))
      .send({
        name: `Receptionist Haircut C ${stamp}`,
        price: 600,
        durationValue: 30,
        durationUnit: "MINUTES",
        salonId: salonAId,
        branchId: branchCId,
        mainServiceId: mainServiceAId,
      });
    expectSuccess(serviceC, 201);

    const customerC = await request(app)
      .post("/api/customers")
      .set(auth(superAdminToken))
      .send({
        name: "Receptionist Customer C",
        phone: `92${String(stamp).slice(-8)}`,
        salonId: salonAId,
        branchId: branchCId,
      });
    expectSuccess(customerC, 201);

    const customer = await request(app)
      .post("/api/customers")
      .set(auth(receptionistToken))
      .send({
        name: "Receptionist Customer A",
        phone: `93${String(stamp).slice(-8)}`,
      });
    expectSuccess(customer, 201);
    const customerAId = customer.body.data.id as string;
    expect(customer.body.data).toMatchObject({
      salonId: salonAId,
      branchId: branchAId,
    });

    const wrongBranchCustomer = await request(app)
      .post("/api/customers")
      .set(auth(receptionistToken))
      .send({
        name: "Wrong Branch Customer",
        phone: `94${String(stamp).slice(-8)}`,
        branchId: branchCId,
      });
    expectFailure(wrongBranchCustomer, 403);
    expect(wrongBranchCustomer.body.message).toBe(
      "You do not have access to this branch"
    );

    const customers = await request(app)
      .get("/api/customers")
      .set(auth(receptionistToken));
    expectSuccess(customers, 200);
    expect(customers.body.data.map((item: { id: string }) => item.id)).toEqual([
      customerAId,
    ]);

    const customerById = await request(app)
      .get(`/api/customers/${customerAId}`)
      .set(auth(receptionistToken));
    expectSuccess(customerById, 200);

    const hiddenCustomer = await request(app)
      .get(`/api/customers/${customerC.body.data.id}`)
      .set(auth(receptionistToken));
    expectFailure(hiddenCustomer, 404);

    const customerUpdate = await request(app)
      .put(`/api/customers/${customerAId}`)
      .set(auth(receptionistToken))
      .send({ customNotes: "Updated by receptionist" });
    expectSuccess(customerUpdate, 200);
    expect(customerUpdate.body.data.customNotes).toBe(
      "Updated by receptionist"
    );

    const customerTransactions = await request(app)
      .get(`/api/customers/${customerAId}/transactions`)
      .set(auth(receptionistToken));
    expectSuccess(customerTransactions, 200);

    const customerDelete = await request(app)
      .delete(`/api/customers/${customerAId}`)
      .set(auth(receptionistToken));
    expectFailure(customerDelete, 403);

    const branches = await request(app)
      .get("/api/branches")
      .set(auth(receptionistToken));
    expectSuccess(branches, 200);
    expect(branches.body.data).toHaveLength(1);
    expect(branches.body.data[0].id).toBe(branchAId);

    const hiddenBranch = await request(app)
      .get(`/api/branches/${branchCId}`)
      .set(auth(receptionistToken));
    expectFailure(hiddenBranch, 404);

    const staff = await request(app)
      .get("/api/staff")
      .set(auth(receptionistToken));
    expectSuccess(staff, 200);
    expect(staff.body.data.map((item: { id: string }) => item.id)).toEqual([
      staffAId,
    ]);

    const services = await request(app)
      .get("/api/services")
      .set(auth(receptionistToken));
    expectSuccess(services, 200);
    expect(
      services.body.data.map((item: { id: string }) => item.id)
    ).toContain(serviceAId);
    expect(
      services.body.data.map((item: { id: string }) => item.id)
    ).not.toContain(serviceC.body.data.id);

    const mainServices = await request(app)
      .get("/api/main-services")
      .set(auth(receptionistToken));
    expectSuccess(mainServices, 200);

    for (const forbiddenRequest of [
      request(app)
        .post("/api/branches")
        .set(auth(receptionistToken))
        .send({ name: "Forbidden Branch" }),
      request(app)
        .post("/api/staff")
        .set(auth(receptionistToken))
        .send({ name: "Forbidden Staff" }),
      request(app)
        .post("/api/services")
        .set(auth(receptionistToken))
        .send({ name: "Forbidden Service" }),
      request(app)
        .post("/api/main-services")
        .set(auth(receptionistToken))
        .send({ name: "Forbidden Main Service" }),
      request(app)
        .get(`/api/main-services/${mainServiceAId}`)
        .set(auth(receptionistToken)),
      request(app)
        .get(`/api/services/${serviceAId}`)
        .set(auth(receptionistToken)),
      request(app)
        .post("/api/users/salon-admin")
        .set(auth(receptionistToken))
        .send({ name: "Forbidden Admin" }),
    ]) {
      const forbidden = await forbiddenRequest;
      expectFailure(forbidden, 403);
    }

    const appointment = await request(app)
      .post("/api/appointments")
      .set(auth(receptionistToken))
      .send({
        customerId: customerAId,
        staffId: staffAId,
        serviceIds: [serviceAId],
        startTime: "2031-01-01T10:00:00.000Z",
      });
    expectSuccess(appointment, 201);
    const appointmentId = appointment.body.data.id as string;
    expect(appointment.body.data).toMatchObject({
      salonId: salonAId,
      branchId: branchAId,
      customerId: customerAId,
      staffId: staffAId,
      createdById: receptionistId,
      createdBy: {
        id: receptionistId,
        role: "RECEPTIONIST",
      },
    });

    const appointments = await request(app)
      .get("/api/appointments")
      .set(auth(receptionistToken));
    expectSuccess(appointments, 200);
    expect(
      appointments.body.data.map((item: { id: string }) => item.id)
    ).toEqual([appointmentId]);

    const appointmentById = await request(app)
      .get(`/api/appointments/${appointmentId}`)
      .set(auth(receptionistToken));
    expectSuccess(appointmentById, 200);
    expect(appointmentById.body.data.createdBy.id).toBe(receptionistId);

    const reschedule = await request(app)
      .patch(`/api/appointments/${appointmentId}/reschedule`)
      .set(auth(receptionistToken))
      .send({ startTime: "2031-01-01T12:00:00.000Z" });
    expectSuccess(reschedule, 200);

    for (const status of ["CONFIRMED", "CHECKED_IN", "COMPLETED"]) {
      const statusUpdate = await request(app)
        .patch(`/api/appointments/${appointmentId}/status`)
        .set(auth(receptionistToken))
        .send({ status, note: `Receptionist changed status to ${status}` });
      expectSuccess(statusUpdate, 200);
    }

    const tracking = await request(app)
      .get(`/api/appointments/${appointmentId}/tracking`)
      .set(auth(receptionistToken));
    expectSuccess(tracking, 200);
    expect(tracking.body.data).toHaveLength(3);
    expect(tracking.body.data[0]).toMatchObject({
      oldStatus: "SCHEDULED",
      newStatus: "CONFIRMED",
      changedBy: {
        id: receptionistId,
        role: "RECEPTIONIST",
      },
    });

    const appointmentDelete = await request(app)
      .delete(`/api/appointments/${appointmentId}`)
      .set(auth(receptionistToken));
    expectFailure(appointmentDelete, 403);

    const wrongBranchAppointment = await request(app)
      .post("/api/appointments")
      .set(auth(receptionistToken))
      .send({
        branchId: branchCId,
        customerId: customerC.body.data.id,
        staffId: staffC.body.data.id,
        serviceIds: [serviceC.body.data.id],
        startTime: "2031-01-02T10:00:00.000Z",
      });
    expectFailure(wrongBranchAppointment, 403);
    expect(wrongBranchAppointment.body.message).toBe(
      "You do not have access to this branch"
    );

    const salonB = await request(app)
      .post("/api/salons")
      .set(auth(superAdminToken))
      .send({ name: `Receptionist Salon B ${stamp}` });
    expectSuccess(salonB, 201);

    const branchB = await request(app)
      .post("/api/branches")
      .set(auth(superAdminToken))
      .send({
        name: `Receptionist Branch B ${stamp}`,
        salonId: salonB.body.data.id,
      });
    expectSuccess(branchB, 201);

    const crossTenantAppointment = await request(app)
      .post("/api/appointments")
      .set(auth(receptionistToken))
      .send({
        branchId: branchB.body.data.id,
        customerId: customerAId,
        staffId: staffAId,
        serviceIds: [serviceAId],
        startTime: "2031-01-03T10:00:00.000Z",
      });
    expectFailure(crossTenantAppointment, 403);
  });
});
