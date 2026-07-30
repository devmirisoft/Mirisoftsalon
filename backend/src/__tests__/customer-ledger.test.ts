import request from "supertest";
import { app } from "../app.js";
import { prisma } from "../config/prisma.js";
import { hashPass } from "../utils/password.js";

const auth = (token: string) => ({
  Authorization: `Bearer ${token}`,
});

const expectStatus = (res: request.Response, status: number) => {
  if (res.status !== status) {
    throw new Error(
      `Expected ${status}, received ${res.status}: ${JSON.stringify(res.body)}`
    );
  }
};

const numberValue = (value: unknown) => Number(value);

const expectOutstandingAmount = (
  res: request.Response,
  expectedAmount: number,
  context: string
) => {
  const actualAmount = numberValue(res.body.data.outstandingAmount);

  if (actualAmount !== expectedAmount) {
    throw new Error(
      `${context}: expected customer outstandingAmount ${expectedAmount}, received ${actualAmount}. Response: ${JSON.stringify(
        res.body
      )}`
    );
  }
};

type LedgerTransaction = {
  type: string;
  debit: unknown;
  credit: unknown;
  billNo: string | null;
  invoiceId: string | null;
  paymentId: string | null;
  status: string;
  balanceAfter: unknown;
};

const getInvoiceTransactions = (
  res: request.Response,
  invoiceId: string,
  expectedCount: number,
  context: string
) => {
  if (!Array.isArray(res.body.data)) {
    throw new Error(
      `${context}: expected CustomerTransaction array, received ${JSON.stringify(
        res.body
      )}`
    );
  }

  const invoiceTransactions = (res.body.data as LedgerTransaction[]).filter(
    (transaction) => transaction.invoiceId === invoiceId
  );

  if (invoiceTransactions.length !== expectedCount) {
    throw new Error(
      `${context}: expected ${expectedCount} CustomerTransaction rows for invoice ${invoiceId}, received ${invoiceTransactions.length}. Transactions: ${JSON.stringify(
        res.body.data
      )}`
    );
  }

  return invoiceTransactions;
};

const expectLedgerTransaction = (
  transaction: LedgerTransaction | undefined,
  expected: {
    type: "INVOICE" | "PAYMENT";
    debit: number;
    credit: number;
    billNo: string;
    invoiceId: string;
    paymentId: string | null;
    balanceAfter: number;
  },
  context: string
) => {
  if (!transaction) {
    throw new Error(`${context}: expected CustomerTransaction row was missing`);
  }

  expect(transaction).toMatchObject({
    type: expected.type,
    billNo: expected.billNo,
    invoiceId: expected.invoiceId,
    paymentId: expected.paymentId,
    status: "COMPLETE",
  });
  expect(numberValue(transaction.debit)).toBe(expected.debit);
  expect(numberValue(transaction.credit)).toBe(expected.credit);
  expect(numberValue(transaction.balanceAfter)).toBe(expected.balanceAfter);
};

describe("Customer ledger flow", () => {
  it("updates outstanding amount and customer transactions for invoice and payments", async () => {
    const stamp = Date.now();
    const superAdminPassword = "Password@123";
    const superAdminEmail = `ledger-super-${stamp}@example.com`;

    await prisma.user.create({
      data: {
        name: "Ledger Super Admin",
        email: superAdminEmail,
        passwordHash: await hashPass(superAdminPassword),
        role: "SUPER_ADMIN",
      },
    });

    const superLogin = await request(app).post("/api/auth/login").send({
      email: superAdminEmail,
      password: superAdminPassword,
    });
    expectStatus(superLogin, 200);
    const superToken = superLogin.body.data.accessToken as string;

    const salon = await request(app)
      .post("/api/salons")
      .set(auth(superToken))
      .send({
        name: `Ledger Salon A ${stamp}`,
        email: `ledger-salon-a-${stamp}@example.com`,
        phone: "9876500001",
      });
    expectStatus(salon, 201);
    const salonId = salon.body.data.id as string;

    const branch = await request(app)
      .post("/api/branches")
      .set(auth(superToken))
      .send({
        name: `Ledger Branch A ${stamp}`,
        salonId,
      });
    expectStatus(branch, 201);
    const branchId = branch.body.data.id as string;

    const salonAdminPassword = "Password@123";
    const salonAdminEmail = `ledger-salon-admin-${stamp}@example.com`;
    const salonAdmin = await request(app)
      .post("/api/users/salon-admin")
      .set(auth(superToken))
      .send({
        name: "Ledger Salon Admin",
        email: salonAdminEmail,
        phone_number: `91${String(stamp).slice(-8)}`,
        password: salonAdminPassword,
        salonId,
      });
    expectStatus(salonAdmin, 201);

    const salonAdminLogin = await request(app).post("/api/auth/login").send({
      email: salonAdminEmail,
      password: salonAdminPassword,
    });
    expectStatus(salonAdminLogin, 200);
    expect(salonAdminLogin.body.data.user.salonId).toBe(salonId);
    const salonAdminToken = salonAdminLogin.body.data.accessToken as string;

    const staff = await request(app)
      .post("/api/staff")
      .set(auth(salonAdminToken))
      .send({
        name: "Ledger Staff A",
        email: `ledger-staff-a-${stamp}@example.com`,
        phone: "9811111111",
        jobRole: "Stylist",
        workingFrom: "10:00",
        workingTo: "19:00",
        weekOff: "MONDAY",
        branchId,
      });
    expectStatus(staff, 201);
    const staffId = staff.body.data.id as string;

    const customer = await request(app)
      .post("/api/customers")
      .set(auth(salonAdminToken))
      .send({
        name: "Ledger Customer A",
        phone: `98${String(stamp).slice(-8)}`,
        email: `ledger-customer-a-${stamp}@example.com`,
        branchId,
      });
    expectStatus(customer, 201);
    const customerId = customer.body.data.id as string;

    const mainService = await request(app)
      .post("/api/main-services")
      .set(auth(salonAdminToken))
      .send({
        name: `Ledger Hair ${stamp}`,
      });
    expectStatus(mainService, 201);
    const mainServiceId = mainService.body.data.id as string;

    const service = await request(app)
      .post("/api/services")
      .set(auth(salonAdminToken))
      .send({
        name: `Ledger Haircut ${stamp}`,
        price: 599,
        durationValue: 45,
        durationUnit: "MINUTES",
        branchId,
        mainServiceId,
      });
    expectStatus(service, 201);
    const serviceId = service.body.data.id as string;

    const appointment = await request(app)
      .post("/api/appointments")
      .set(auth(salonAdminToken))
      .send({
        branchId,
        customerId,
        staffId,
        serviceIds: [serviceId],
        startTime: "2030-02-01T10:00:00.000Z",
      });
    expectStatus(appointment, 201);
    const appointmentId = appointment.body.data.id as string;
    expect(numberValue(appointment.body.data.estimatedAmount)).toBe(599);
    expect(appointment.body.data.totalDurationMinutes).toBe(45);

    for (const status of ["CONFIRMED", "CHECKED_IN", "COMPLETED"]) {
      const statusRes = await request(app)
        .patch(`/api/appointments/${appointmentId}/status`)
        .set(auth(salonAdminToken))
        .send({
          status,
          note: `Ledger test moved to ${status}`,
        });
      expectStatus(statusRes, 200);
    }

    const invoice = await request(app)
      .post(`/api/invoices/from-appointment/${appointmentId}`)
      .set(auth(salonAdminToken))
      .send({
        invoiceType: "BILL_OF_SUPPLY",
        discountAmount: 0,
        processingFeeAmount: 0,
      });
    expectStatus(invoice, 201);
    const invoiceId = invoice.body.data.id as string;
    const invoiceCode = invoice.body.data.invoiceCode as string;
    expect(numberValue(invoice.body.data.totalAmount)).toBe(599);
    expect(invoice.body.data.paymentStatus).toBe("UNPAID");
    expect(numberValue(invoice.body.data.balanceAmount)).toBe(599);

    let customerAfterInvoice = await request(app)
      .get(`/api/customers/${customerId}`)
      .set(auth(salonAdminToken));
    expectStatus(customerAfterInvoice, 200);
    expectOutstandingAmount(customerAfterInvoice, 599, "After invoice creation");

    let transactions = await request(app)
      .get(`/api/customers/${customerId}/transactions`)
      .set(auth(salonAdminToken));
    expectStatus(transactions, 200);
    let invoiceTransactions = getInvoiceTransactions(
      transactions,
      invoiceId,
      1,
      "After invoice creation"
    );
    expectLedgerTransaction(invoiceTransactions[0], {
      type: "INVOICE",
      billNo: invoiceCode,
      invoiceId,
      paymentId: null,
      debit: 599,
      credit: 0,
      balanceAfter: 599,
    }, "After invoice creation");

    const partialPayment = await request(app)
      .post("/api/payments")
      .set(auth(salonAdminToken))
      .send({
        invoiceId,
        amount: 200,
        method: "UPI",
        referenceNo: "UPI_LEDGER_TEST_001",
        note: "Partial payment ledger test",
      });
    expectStatus(partialPayment, 201);
    const partialPaymentId = partialPayment.body.data.payment.id as string;
    expect(numberValue(partialPayment.body.data.invoice.paidAmount)).toBe(200);
    expect(numberValue(partialPayment.body.data.invoice.balanceAmount)).toBe(399);
    expect(partialPayment.body.data.invoice.paymentStatus).toBe("PARTIALLY_PAID");

    customerAfterInvoice = await request(app)
      .get(`/api/customers/${customerId}`)
      .set(auth(salonAdminToken));
    expectStatus(customerAfterInvoice, 200);
    expectOutstandingAmount(customerAfterInvoice, 399, "After partial payment");

    transactions = await request(app)
      .get(`/api/customers/${customerId}/transactions`)
      .set(auth(salonAdminToken));
    expectStatus(transactions, 200);
    invoiceTransactions = getInvoiceTransactions(
      transactions,
      invoiceId,
      2,
      "After partial payment"
    );
    expectLedgerTransaction(invoiceTransactions[1], {
      type: "PAYMENT",
      billNo: invoiceCode,
      invoiceId,
      paymentId: partialPaymentId,
      debit: 0,
      credit: 200,
      balanceAfter: 399,
    }, "After partial payment");

    const finalPayment = await request(app)
      .post("/api/payments")
      .set(auth(salonAdminToken))
      .send({
        invoiceId,
        amount: 399,
        method: "CASH",
        note: "Final payment ledger test",
      });
    expectStatus(finalPayment, 201);
    const finalPaymentId = finalPayment.body.data.payment.id as string;
    expect(numberValue(finalPayment.body.data.invoice.paidAmount)).toBe(599);
    expect(numberValue(finalPayment.body.data.invoice.balanceAmount)).toBe(0);
    expect(finalPayment.body.data.invoice.paymentStatus).toBe("PAID");

    const customerAfterFinalPayment = await request(app)
      .get(`/api/customers/${customerId}`)
      .set(auth(salonAdminToken));
    expectStatus(customerAfterFinalPayment, 200);
    expectOutstandingAmount(
      customerAfterFinalPayment,
      0,
      "After final payment"
    );

    transactions = await request(app)
      .get(`/api/customers/${customerId}/transactions`)
      .set(auth(salonAdminToken));
    expectStatus(transactions, 200);
    invoiceTransactions = getInvoiceTransactions(
      transactions,
      invoiceId,
      3,
      "After final payment"
    );
    expect(invoiceTransactions.map((transaction: { type: string }) => transaction.type)).toEqual([
      "INVOICE",
      "PAYMENT",
      "PAYMENT",
    ]);
    expectLedgerTransaction(invoiceTransactions[0], {
      type: "INVOICE",
      billNo: invoiceCode,
      invoiceId,
      paymentId: null,
      debit: 599,
      credit: 0,
      balanceAfter: 599,
    }, "Final ledger entry 1");
    expectLedgerTransaction(invoiceTransactions[1], {
      type: "PAYMENT",
      billNo: invoiceCode,
      invoiceId,
      paymentId: partialPaymentId,
      debit: 0,
      credit: 200,
      balanceAfter: 399,
    }, "Final ledger entry 2");
    expectLedgerTransaction(invoiceTransactions[2], {
      type: "PAYMENT",
      billNo: invoiceCode,
      invoiceId,
      paymentId: finalPaymentId,
      debit: 0,
      credit: 399,
      balanceAfter: 0,
    }, "Final ledger entry 3");

    const overpayment = await request(app)
      .post("/api/payments")
      .set(auth(salonAdminToken))
      .send({
        invoiceId,
        amount: 1,
        method: "CASH",
      });
    expectStatus(overpayment, 400);

    const invoiceAfterOverpayment = await request(app)
      .get(`/api/invoices/${invoiceId}`)
      .set(auth(salonAdminToken));
    expectStatus(invoiceAfterOverpayment, 200);
    expect(invoiceAfterOverpayment.body.data.paymentStatus).toBe("PAID");
    expect(numberValue(invoiceAfterOverpayment.body.data.balanceAmount)).toBe(0);

    const customerAfterOverpayment = await request(app)
      .get(`/api/customers/${customerId}`)
      .set(auth(salonAdminToken));
    expectStatus(customerAfterOverpayment, 200);
    expectOutstandingAmount(
      customerAfterOverpayment,
      0,
      "After rejected overpayment"
    );

    const transactionsAfterOverpayment = await request(app)
      .get(`/api/customers/${customerId}/transactions`)
      .set(auth(salonAdminToken));
    expectStatus(transactionsAfterOverpayment, 200);
    getInvoiceTransactions(
      transactionsAfterOverpayment,
      invoiceId,
      3,
      "After rejected overpayment"
    );

    const salonB = await request(app)
      .post("/api/salons")
      .set(auth(superToken))
      .send({
        name: `Ledger Salon B ${stamp}`,
      });
    expectStatus(salonB, 201);
    const salonBId = salonB.body.data.id as string;

    const branchB = await request(app)
      .post("/api/branches")
      .set(auth(superToken))
      .send({
        name: `Ledger Branch B ${stamp}`,
        salonId: salonBId,
      });
    expectStatus(branchB, 201);
    const branchBId = branchB.body.data.id as string;

    const staffB = await request(app)
      .post("/api/staff")
      .set(auth(superToken))
      .send({
        name: "Ledger Staff B",
        email: `ledger-staff-b-${stamp}@example.com`,
        phone: "9822222222",
        jobRole: "Stylist",
        workingFrom: "10:00",
        workingTo: "19:00",
        weekOff: "TUESDAY",
        salonId: salonBId,
        branchId: branchBId,
      });
    expectStatus(staffB, 201);

    const customerB = await request(app)
      .post("/api/customers")
      .set(auth(superToken))
      .send({
        name: "Ledger Customer B",
        phone: `97${String(stamp).slice(-8)}`,
        salonId: salonBId,
        branchId: branchBId,
      });
    expectStatus(customerB, 201);

    const mainServiceB = await request(app)
      .post("/api/main-services")
      .set(auth(superToken))
      .send({
        name: `Ledger Skin ${stamp}`,
        salonId: salonBId,
      });
    expectStatus(mainServiceB, 201);

    const serviceB = await request(app)
      .post("/api/services")
      .set(auth(superToken))
      .send({
        name: `Ledger Facial ${stamp}`,
        price: 599,
        durationValue: 45,
        durationUnit: "MINUTES",
        salonId: salonBId,
        branchId: branchBId,
        mainServiceId: mainServiceB.body.data.id,
      });
    expectStatus(serviceB, 201);

    const appointmentB = await request(app)
      .post("/api/appointments")
      .set(auth(superToken))
      .send({
        salonId: salonBId,
        branchId: branchBId,
        customerId: customerB.body.data.id,
        staffId: staffB.body.data.id,
        serviceIds: [serviceB.body.data.id],
        startTime: "2030-02-02T10:00:00.000Z",
      });
    expectStatus(appointmentB, 201);

    for (const status of ["CONFIRMED", "CHECKED_IN", "COMPLETED"]) {
      const statusRes = await request(app)
        .patch(`/api/appointments/${appointmentB.body.data.id}/status`)
        .set(auth(superToken))
        .send({ status });
      expectStatus(statusRes, 200);
    }

    const crossTenantInvoice = await request(app)
      .post(`/api/invoices/from-appointment/${appointmentB.body.data.id}`)
      .set(auth(salonAdminToken))
      .send({
        invoiceType: "BILL_OF_SUPPLY",
        discountAmount: 0,
        processingFeeAmount: 0,
      });
    expectStatus(crossTenantInvoice, 404);

    const invoiceB = await request(app)
      .post(`/api/invoices/from-appointment/${appointmentB.body.data.id}`)
      .set(auth(superToken))
      .send({
        invoiceType: "BILL_OF_SUPPLY",
        discountAmount: 0,
        processingFeeAmount: 0,
      });
    expectStatus(invoiceB, 201);

    const crossTenantPayment = await request(app)
      .post("/api/payments")
      .set(auth(salonAdminToken))
      .send({
        invoiceId: invoiceB.body.data.id,
        amount: 100,
        method: "CASH",
      });
    expectStatus(crossTenantPayment, 404);
  });
});
