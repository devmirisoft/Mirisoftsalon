import request from "supertest";
import { app } from "../app.js";
import { prisma } from "../config/prisma.js";
import { hashPass } from "../utils/password.js";

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

describe("Salon SaaS backend E2E flow", () => {
  it("runs the main salon flow, billing flow, and tenant isolation checks", async () => {
    const stamp = Date.now();

    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);

    const protectedWithoutToken = await request(app).get("/api/customers");
    expectFailure(protectedWithoutToken, 401);

    const superAdminEmail = `super-${stamp}@example.com`;
    const superAdminPassword = "Password@123";

    await prisma.user.create({
      data: {
        name: "E2E Super Admin",
        email: superAdminEmail,
        passwordHash: await hashPass(superAdminPassword),
        role: "SUPER_ADMIN",
      },
    });

    const superAdminLogin = await request(app).post("/api/auth/login").send({
      email: superAdminEmail,
      password: superAdminPassword,
    });
    expectSuccess(superAdminLogin, 200);
    const superAdminToken = superAdminLogin.body.data.accessToken as string;

    const salonARes = await request(app)
      .post("/api/salons")
      .set(auth(superAdminToken))
      .send({
        name: `E2E Salon A ${stamp}`,
        email: `salon-a-${stamp}@example.com`,
        phone: "9876500001",
        addressLine1: "A Street",
        city: "Mumbai",
        state: "MH",
        postalCode: "400001",
      });
    expectSuccess(salonARes, 201);
    const salonAId = salonARes.body.data.id as string;

    const branchCrudRes = await request(app)
      .post("/api/branches")
      .set(auth(superAdminToken))
      .send({
        name: `E2E Branch CRUD ${stamp}`,
        salonId: salonAId,
        city: "Mumbai",
      });
    expectSuccess(branchCrudRes, 201);
    const branchCrudId = branchCrudRes.body.data.id as string;

    const branchById = await request(app)
      .get(`/api/branches/${branchCrudId}`)
      .set(auth(superAdminToken));
    expectSuccess(branchById, 200);

    const branchUpdate = await request(app)
      .put(`/api/branches/${branchCrudId}`)
      .set(auth(superAdminToken))
      .send({ name: `E2E Branch CRUD Updated ${stamp}` });
    expectSuccess(branchUpdate, 200);
    expect(branchUpdate.body.data.name).toBe(`E2E Branch CRUD Updated ${stamp}`);

    const branchDelete = await request(app)
      .delete(`/api/branches/${branchCrudId}`)
      .set(auth(superAdminToken));
    expectSuccess(branchDelete, 200);

    const branchARes = await request(app)
      .post("/api/branches")
      .set(auth(superAdminToken))
      .send({
        name: `E2E Branch A ${stamp}`,
        salonId: salonAId,
        city: "Mumbai",
      });
    expectSuccess(branchARes, 201);
    const branchAId = branchARes.body.data.id as string;

    const branches = await request(app)
      .get("/api/branches")
      .set(auth(superAdminToken));
    expectSuccess(branches, 200);
    expect(Array.isArray(branches.body.data)).toBe(true);

    const salonAdminEmail = `salon-admin-${stamp}@example.com`;
    const salonAdminPassword = "Password@123";
    const createSalonAdmin = await request(app)
      .post("/api/users/salon-admin")
      .set(auth(superAdminToken))
      .send({
        name: "E2E Salon Admin",
        email: salonAdminEmail,
        phone_number: `9100${String(stamp).slice(-6)}`,
        password: salonAdminPassword,
        salonId: salonAId,
      });
    expectSuccess(createSalonAdmin, 201);

    const salonAdminLogin = await request(app).post("/api/auth/login").send({
      email: salonAdminEmail,
      password: salonAdminPassword,
    });
    expectSuccess(salonAdminLogin, 200);
    expect(salonAdminLogin.body.data.user.salonId).toBe(salonAId);
    const salonAdminToken = salonAdminLogin.body.data.accessToken as string;

    const receptionistEmail = `receptionist-${stamp}@example.com`;
    const receptionistPassword = "Password@123";
    const createReceptionist = await request(app)
      .post("/api/users/receptionist")
      .set(auth(salonAdminToken))
      .send({
        name: "E2E Receptionist A",
        email: receptionistEmail,
        phone_number: `9200${String(stamp).slice(-6)}`,
        password: receptionistPassword,
        branchId: branchAId,
      });
    expectSuccess(createReceptionist, 201);
    expect(createReceptionist.body.data).toMatchObject({
      role: "RECEPTIONIST",
      salonId: salonAId,
      branchId: branchAId,
    });

    const receptionistLogin = await request(app).post("/api/auth/login").send({
      email: receptionistEmail,
      password: receptionistPassword,
    });
    expectSuccess(receptionistLogin, 200);
    expect(receptionistLogin.body.data.user).toMatchObject({
      role: "RECEPTIONIST",
      salonId: salonAId,
      branchId: branchAId,
    });

    const staffRes = await request(app)
      .post("/api/staff")
      .set(auth(salonAdminToken))
      .send({
        name: "E2E Staff A",
        email: `staff-a-${stamp}@example.com`,
        phone: "9811111111",
        jobRole: "Stylist",
        workingFrom: "10:00",
        workingTo: "19:00",
        weekOff: "MONDAY",
        branchId: branchAId,
      });
    expectSuccess(staffRes, 201);
    const staffAId = staffRes.body.data.id as string;

    const staffPassword = "Password@123";
    const createStaffAccount = await request(app)
      .post("/api/users/staff")
      .set(auth(salonAdminToken))
      .send({ staffId: staffAId, password: staffPassword });
    expectSuccess(createStaffAccount, 201);
    expect(createStaffAccount.body.data).toMatchObject({
      role: "STAFF",
      salonId: salonAId,
      branchId: branchAId,
    });

    const staffLogin = await request(app).post("/api/auth/login").send({
      email: `staff-a-${stamp}@example.com`,
      password: staffPassword,
    });
    expectSuccess(staffLogin, 200);
    expect(staffLogin.body.data.user).toMatchObject({
      role: "STAFF",
      salonId: salonAId,
      branchId: branchAId,
    });

    const staffList = await request(app)
      .get("/api/staff")
      .set(auth(salonAdminToken));
    expectSuccess(staffList, 200);

    const staffById = await request(app)
      .get(`/api/staff/${staffAId}`)
      .set(auth(salonAdminToken));
    expectSuccess(staffById, 200);

    const staffStatus = await request(app)
      .patch(`/api/staff/${staffAId}/status`)
      .set(auth(salonAdminToken))
      .send({ status: false });
    expectSuccess(staffStatus, 200);

    await request(app)
      .patch(`/api/staff/${staffAId}/status`)
      .set(auth(salonAdminToken))
      .send({ status: true })
      .expect(200);

    const customerAPhone = `98${String(stamp).slice(-8)}`;
    const customerAEmail = `customer-a-${stamp}@example.com`;
    const customerRes = await request(app)
      .post("/api/customers")
      .set(auth(salonAdminToken))
      .send({
        name: "E2E Customer A",
        phone: customerAPhone,
        email: customerAEmail,
        gst: "27ABCDE1234F1Z5",
        customNotes: "Prefers morning appointments",
        branchId: branchAId,
      });
    expectSuccess(customerRes, 201);
    const customerAId = customerRes.body.data.id as string;

    const duplicateCustomerPhone = await request(app)
      .post("/api/customers")
      .set(auth(salonAdminToken))
      .send({ name: "Duplicate Phone", phone: customerAPhone, email: `other-${stamp}@example.com` });
    expectFailure(duplicateCustomerPhone, 400);

    const duplicateCustomerEmail = await request(app)
      .post("/api/customers")
      .set(auth(salonAdminToken))
      .send({ name: "Duplicate Email", phone: `96${String(stamp).slice(-8)}`, email: customerAEmail });
    expectFailure(duplicateCustomerEmail, 400);

    const missingCustomerContact = await request(app)
      .post("/api/customers")
      .set(auth(salonAdminToken))
      .send({ name: "Missing Contact" });
    expectFailure(missingCustomerContact, 400);

    const customerList = await request(app)
      .get("/api/customers")
      .set(auth(salonAdminToken));
    expectSuccess(customerList, 200);

    const customerById = await request(app)
      .get(`/api/customers/${customerAId}`)
      .set(auth(salonAdminToken));
    expectSuccess(customerById, 200);

    const mainServiceRes = await request(app)
      .post("/api/main-services")
      .set(auth(salonAdminToken))
      .send({ name: `E2E Hair ${stamp}` });
    expectSuccess(mainServiceRes, 201);
    const mainServiceAId = mainServiceRes.body.data.id as string;

    const mainServices = await request(app)
      .get("/api/main-services")
      .set(auth(salonAdminToken));
    expectSuccess(mainServices, 200);

    const serviceRes = await request(app)
      .post("/api/services")
      .set(auth(salonAdminToken))
      .send({
        name: `E2E Haircut ${stamp}`,
        description: "E2E test service",
        price: 599,
        durationValue: 45,
        durationUnit: "MINUTES",
        branchId: branchAId,
        mainServiceId: mainServiceAId,
      });
    expectSuccess(serviceRes, 201);
    const serviceAId = serviceRes.body.data.id as string;

    const services = await request(app)
      .get("/api/services")
      .set(auth(salonAdminToken));
    expectSuccess(services, 200);

    await request(app)
      .patch(`/api/staff/${staffAId}/status`)
      .set(auth(salonAdminToken))
      .send({ status: false })
      .expect(200);
    const inactiveStaffAppointment = await request(app)
      .post("/api/appointments")
      .set(auth(salonAdminToken))
      .send({
        branchId: branchAId,
        customerId: customerAId,
        staffId: staffAId,
        serviceIds: [serviceAId],
        startTime: "2030-01-01T10:00:00.000Z",
      });
    expectFailure(inactiveStaffAppointment, 400);
    await request(app)
      .patch(`/api/staff/${staffAId}/status`)
      .set(auth(salonAdminToken))
      .send({ status: true })
      .expect(200);

    const outsideWorkingHours = await request(app)
      .post("/api/appointments")
      .set(auth(salonAdminToken))
      .send({
        branchId: branchAId,
        customerId: customerAId,
        staffId: staffAId,
        serviceIds: [serviceAId],
        startTime: "2030-01-01T20:00:00.000Z",
      });
    expectFailure(outsideWorkingHours, 400);

    const weekOffAppointment = await request(app)
      .post("/api/appointments")
      .set(auth(salonAdminToken))
      .send({
        branchId: branchAId,
        customerId: customerAId,
        staffId: staffAId,
        serviceIds: [serviceAId],
        startTime: "2030-01-07T10:00:00.000Z",
      });
    expectFailure(weekOffAppointment, 400);

    const startTime = "2030-01-01T10:00:00.000Z";
    const appointmentRes = await request(app)
      .post("/api/appointments")
      .set(auth(salonAdminToken))
      .send({
        branchId: branchAId,
        customerId: customerAId,
        staffId: staffAId,
        serviceIds: [serviceAId],
        startTime,
        bookingNote: "Customer prefers morning slot",
      });
    expectSuccess(appointmentRes, 201);
    const appointmentA = appointmentRes.body.data;
    const appointmentAId = appointmentA.id as string;
    expect(appointmentA.totalDurationMinutes).toBe(45);
    expect(Number(appointmentA.estimatedAmount)).toBe(599);
    expect(new Date(appointmentA.endTime).toISOString()).toBe(
      "2030-01-01T10:45:00.000Z"
    );
    expect(
      await prisma.auditLog.count({
        where: { entityId: appointmentAId, module: "APPOINTMENT", action: "CREATE" },
      })
    ).toBe(1);

    const invalidStatusJump = await request(app)
      .patch(`/api/appointments/${appointmentAId}/status`)
      .set(auth(salonAdminToken))
      .send({ status: "COMPLETED" });
    expectFailure(invalidStatusJump, 400);

    const notCompletedInvoice = await request(app)
      .post(`/api/invoices/from-appointment/${appointmentAId}`)
      .set(auth(salonAdminToken))
      .send({ invoiceType: "BILL_OF_SUPPLY" });
    expectFailure(notCompletedInvoice, 400);

    const conflict = await request(app)
      .post("/api/appointments")
      .set(auth(salonAdminToken))
      .send({
        branchId: branchAId,
        customerId: customerAId,
        staffId: staffAId,
        serviceIds: [serviceAId],
        startTime: "2030-01-01T10:30:00.000Z",
      });
    expectFailure(conflict, 409);

    const appointmentBRes = await request(app)
      .post("/api/appointments")
      .set(auth(salonAdminToken))
      .send({
        branchId: branchAId,
        customerId: customerAId,
        staffId: staffAId,
        serviceIds: [serviceAId],
        startTime: appointmentA.endTime,
      });
    expectSuccess(appointmentBRes, 201);
    const appointmentBId = appointmentBRes.body.data.id as string;

    const appointments = await request(app)
      .get("/api/appointments")
      .set(auth(salonAdminToken));
    expectSuccess(appointments, 200);

    const appointmentById = await request(app)
      .get(`/api/appointments/${appointmentAId}`)
      .set(auth(salonAdminToken));
    expectSuccess(appointmentById, 200);

    const reschedule = await request(app)
      .patch(`/api/appointments/${appointmentBId}/reschedule`)
      .set(auth(salonAdminToken))
      .send({ startTime: "2030-01-01T12:30:00.000Z" });
    expectSuccess(reschedule, 200);
    const basicUpdate = await request(app)
      .put(`/api/appointments/${appointmentBId}`)
      .set(auth(salonAdminToken))
      .send({ bookingNote: "Updated safely" });
    expectSuccess(basicUpdate, 200);
    expect(await prisma.auditLog.count({ where: { entityId: appointmentBId, action: "UPDATE" } })).toBe(2);

    for (const status of ["CONFIRMED", "CHECKED_IN", "COMPLETED"]) {
      const statusRes = await request(app)
        .patch(`/api/appointments/${appointmentAId}/status`)
        .set(auth(salonAdminToken))
        .send({ status, note: `Moved to ${status}` });
      expectSuccess(statusRes, 200);
      expect(statusRes.body.data.status).toBe(status);
    }

    const editCompletedAppointment = await request(app)
      .put(`/api/appointments/${appointmentAId}`)
      .set(auth(salonAdminToken))
      .send({ bookingNote: "Should not be changed" });
    expectFailure(editCompletedAppointment, 400);

    const tracking = await request(app)
      .get(`/api/appointments/${appointmentAId}/tracking`)
      .set(auth(salonAdminToken));
    expectSuccess(tracking, 200);
    expect(tracking.body.data).toHaveLength(3);
    expect(tracking.body.data[0].oldStatus).toBe("SCHEDULED");
    expect(tracking.body.data[0].newStatus).toBe("CONFIRMED");
    expect(tracking.body.data[0].note).toBe("Moved to CONFIRMED");
    expect(tracking.body.data[0].changedBy.id).toBe(
      salonAdminLogin.body.data.user.id
    );

    const billInvoiceRes = await request(app)
      .post(`/api/invoices/from-appointment/${appointmentAId}`)
      .set(auth(salonAdminToken))
      .send({ invoiceType: "BILL_OF_SUPPLY" });
    expectSuccess(billInvoiceRes, 201);
    const billInvoice = billInvoiceRes.body.data;
    const billInvoiceId = billInvoice.id as string;
    expect(Number(billInvoice.taxAmount)).toBe(0);
    expect(Number(billInvoice.totalAmount)).toBe(599);
    expect(billInvoice.paymentStatus).toBe("UNPAID");
    expect(await prisma.invoiceItem.count({ where: { invoiceId: billInvoiceId } })).toBeGreaterThan(0);
    expect(await prisma.customerTransaction.count({ where: { invoiceId: billInvoiceId, type: "INVOICE" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: billInvoiceId, module: "INVOICE", action: "CREATE" } })).toBe(1);

    const duplicateInvoice = await request(app)
      .post(`/api/invoices/from-appointment/${appointmentAId}`)
      .set(auth(salonAdminToken))
      .send({ invoiceType: "BILL_OF_SUPPLY" });
    expectFailure(duplicateInvoice, 400);

    await request(app)
      .patch(`/api/appointments/${appointmentBId}/status`)
      .set(auth(salonAdminToken))
      .send({ status: "CONFIRMED" })
      .expect(200);
    await request(app)
      .patch(`/api/appointments/${appointmentBId}/status`)
      .set(auth(salonAdminToken))
      .send({ status: "CHECKED_IN" })
      .expect(200);
    await request(app)
      .patch(`/api/appointments/${appointmentBId}/status`)
      .set(auth(salonAdminToken))
      .send({ status: "COMPLETED" })
      .expect(200);

    const gstInvoiceRes = await request(app)
      .post(`/api/invoices/from-appointment/${appointmentBId}`)
      .set(auth(salonAdminToken))
      .send({ invoiceType: "GST_INVOICE", taxPercent: 18 });
    expectSuccess(gstInvoiceRes, 201);
    expect(Number(gstInvoiceRes.body.data.taxAmount)).toBe(107.82);
    const gstInvoiceId = gstInvoiceRes.body.data.id as string;

    const invoices = await request(app)
      .get("/api/invoices")
      .set(auth(salonAdminToken));
    expectSuccess(invoices, 200);

    const invoiceById = await request(app)
      .get(`/api/invoices/${billInvoiceId}`)
      .set(auth(salonAdminToken));
    expectSuccess(invoiceById, 200);

    const partialPayment = await request(app)
      .post("/api/payments")
      .set(auth(salonAdminToken))
      .send({
        invoiceId: billInvoiceId,
        amount: 200,
        method: "CASH",
        referenceNo: "E2E-PARTIAL",
      });
    expectSuccess(partialPayment, 201);
    expect(Number(partialPayment.body.data.invoice.paidAmount)).toBe(200);
    expect(Number(partialPayment.body.data.invoice.balanceAmount)).toBe(399);
    expect(partialPayment.body.data.invoice.paymentStatus).toBe("PARTIALLY_PAID");
    const partialPaymentId = partialPayment.body.data.payment.id as string;

    const overPayment = await request(app)
      .post("/api/payments")
      .set(auth(salonAdminToken))
      .send({
        invoiceId: billInvoiceId,
        amount: 400,
        method: "CASH",
      });
    expectFailure(overPayment, 400);

    const fullPayment = await request(app)
      .post("/api/payments")
      .set(auth(salonAdminToken))
      .send({
        invoiceId: billInvoiceId,
        amount: 399,
        method: "UPI",
        referenceNo: "E2E-FULL",
      });
    expectSuccess(fullPayment, 201);
    expect(Number(fullPayment.body.data.invoice.balanceAmount)).toBe(0);
    expect(fullPayment.body.data.invoice.paymentStatus).toBe("PAID");
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: { in: [partialPaymentId, fullPayment.body.data.payment.id] },
          module: "PAYMENT",
          action: "PAYMENT_RECORDED",
        },
      })
    ).toBe(2);

    const payments = await request(app)
      .get("/api/payments")
      .set(auth(salonAdminToken));
    expectSuccess(payments, 200);

    const paymentById = await request(app)
      .get(`/api/payments/${partialPaymentId}`)
      .set(auth(salonAdminToken));
    expectSuccess(paymentById, 200);

    const concurrentPayments = await Promise.all([
      request(app)
        .post("/api/payments")
        .set(auth(salonAdminToken))
        .send({ invoiceId: gstInvoiceId, amount: 400, method: "CASH" }),
      request(app)
        .post("/api/payments")
        .set(auth(salonAdminToken))
        .send({ invoiceId: gstInvoiceId, amount: 400, method: "UPI" }),
    ]);
    expect(concurrentPayments.map((response) => response.status).sort()).toEqual([
      201,
      400,
    ]);
    const gstInvoiceAfterConcurrentPayments = await request(app)
      .get(`/api/invoices/${gstInvoiceId}`)
      .set(auth(salonAdminToken));
    expectSuccess(gstInvoiceAfterConcurrentPayments, 200);
    expect(Number(gstInvoiceAfterConcurrentPayments.body.data.paidAmount)).toBe(400);
    expect(Number(gstInvoiceAfterConcurrentPayments.body.data.balanceAmount)).toBe(306.82);

    const salonBRes = await request(app)
      .post("/api/salons")
      .set(auth(superAdminToken))
      .send({ name: `E2E Salon B ${stamp}` });
    expectSuccess(salonBRes, 201);
    const salonBId = salonBRes.body.data.id as string;

    const branchBRes = await request(app)
      .post("/api/branches")
      .set(auth(superAdminToken))
      .send({ name: `E2E Branch B ${stamp}`, salonId: salonBId });
    expectSuccess(branchBRes, 201);
    const branchBId = branchBRes.body.data.id as string;

    const staffBRes = await request(app)
      .post("/api/staff")
      .set(auth(superAdminToken))
      .send({
        name: "E2E Staff B",
        email: `staff-b-${stamp}@example.com`,
        phone: "9822222222",
        jobRole: "Stylist",
        workingFrom: "10:00",
        workingTo: "19:00",
        weekOff: "TUESDAY",
        salonId: salonBId,
        branchId: branchBId,
      });
    expectSuccess(staffBRes, 201);

    const customerBRes = await request(app)
      .post("/api/customers")
      .set(auth(superAdminToken))
      .send({
        name: "E2E Customer B",
        phone: customerAPhone,
        salonId: salonBId,
        branchId: branchBId,
      });
    expectSuccess(customerBRes, 201);

    const mainServiceBRes = await request(app)
      .post("/api/main-services")
      .set(auth(superAdminToken))
      .send({ name: `E2E Skin ${stamp}`, salonId: salonBId });
    expectSuccess(mainServiceBRes, 201);

    const serviceBRes = await request(app)
      .post("/api/services")
      .set(auth(superAdminToken))
      .send({
        name: `E2E Facial ${stamp}`,
        price: 700,
        durationValue: 30,
        durationUnit: "MINUTES",
        salonId: salonBId,
        branchId: branchBId,
        mainServiceId: mainServiceBRes.body.data.id,
      });
    expectSuccess(serviceBRes, 201);

    const crossTenantAppointment = await request(app)
      .post("/api/appointments")
      .set(auth(salonAdminToken))
      .send({
        branchId: branchBId,
        customerId: customerBRes.body.data.id,
        staffId: staffBRes.body.data.id,
        serviceIds: [serviceBRes.body.data.id],
        startTime: "2030-01-02T10:00:00.000Z",
      });
    expectFailure(crossTenantAppointment, 400);
  });
});
