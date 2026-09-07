import request from "supertest";

import { app } from "../app.js";
import { prisma } from "../config/prisma.js";
import { hashPass } from "../utils/password.js";

const ALL_ROUTES = [
  "GET /",
  "GET /api/health",
  "POST /api/auth/register",
  "POST /api/auth/login",
  "POST /api/auth/refresh",
  "GET /api/auth/me",
  "POST /api/auth/logout",
  "GET /api/users",
  "POST /api/users/salon-admin",
  "POST /api/users/branch-manager",
  "POST /api/users/receptionist",
  "POST /api/users/staff",
  "PATCH /api/users/:id/status",
  "POST /api/salons",
  "GET /api/salons",
  "POST /api/branches",
  "GET /api/branches",
  "GET /api/branches/:id",
  "PUT /api/branches/:id",
  "DELETE /api/branches/:id",
  "POST /api/staff",
  "GET /api/staff",
  "GET /api/staff/:id",
  "PUT /api/staff/:id",
  "PATCH /api/staff/:id/status",
  "DELETE /api/staff/:id",
  "POST /api/customers",
  "GET /api/customers",
  "GET /api/customers/:id/transactions",
  "POST /api/customers/:id/wallet/add",
  "GET /api/customers/:id",
  "PUT /api/customers/:id",
  "PATCH /api/customers/:id/membership",
  "DELETE /api/customers/:id",
  "POST /api/memberships",
  "GET /api/memberships",
  "GET /api/memberships/:id",
  "PUT /api/memberships/:id",
  "PATCH /api/memberships/:id/status",
  "DELETE /api/memberships/:id",
  "POST /api/loyalty-rules",
  "GET /api/loyalty-rules",
  "GET /api/loyalty-rules/active",
  "GET /api/loyalty-rules/:id",
  "PUT /api/loyalty-rules/:id",
  "PATCH /api/loyalty-rules/:id/status",
  "GET /api/loyalty/customers/:customerId/transactions",
  "POST /api/loyalty/customers/:customerId/adjust",
  "POST /api/main-services",
  "GET /api/main-services",
  "PATCH /api/main-services/:id/status",
  "GET /api/main-services/:id",
  "PUT /api/main-services/:id",
  "DELETE /api/main-services/:id",
  "POST /api/services",
  "GET /api/services",
  "POST /api/services/seed-defaults",
  "PATCH /api/services/:id/status",
  "GET /api/services/:id",
  "PUT /api/services/:id",
  "DELETE /api/services/:id",
  "POST /api/appointments",
  "GET /api/appointments",
  "PATCH /api/appointments/:id/status",
  "PATCH /api/appointments/:id/reschedule",
  "GET /api/appointments/:id",
  "PUT /api/appointments/:id",
  "DELETE /api/appointments/:id",
  "GET /api/appointments/:id/tracking",
  "POST /api/invoices/from-appointment/:appointmentId",
  "GET /api/invoices",
  "PATCH /api/invoices/:id/cancel",
  "POST /api/invoices/:id/redeem-loyalty",
  "GET /api/invoices/:id",
  "POST /api/payments",
  "GET /api/payments",
  "GET /api/payments/:id",
] as const;

const auth = (token: string) => ({
  Authorization: `Bearer ${token}`,
});

describe("All API routes", () => {
  it("exercises every registered route through a real integration flow", async () => {
    const testedRoutes = new Set<string>();
    const stamp = Date.now();
    const password = "Password@123";
    const agent = request.agent(app);

    const check = (
      route: (typeof ALL_ROUTES)[number],
      response: request.Response,
      expectedStatus: number
    ) => {
      testedRoutes.add(route);

      if (response.status !== expectedStatus) {
        throw new Error(
          `${route}: expected ${expectedStatus}, received ${response.status}: ${JSON.stringify(response.body)}`
        );
      }

      expect(response.body.success).toBe(true);
      return response;
    };

    check("GET /", await agent.get("/"), 200);
    check("GET /api/health", await agent.get("/api/health"), 200);

    const superAdminEmail = `all-routes-super-${stamp}@example.com`;
    check(
      "POST /api/auth/register",
      await agent.post("/api/auth/register").send({
        salonName: `All Routes Onboarding Salon ${stamp}`,
        branchName: "Main Branch",
        adminName: "All Routes Onboarding Admin",
        email: `all-routes-onboarding-${stamp}@example.com`,
        phone: "9000000001",
        password,
        confirmPassword: password,
      }),
      201
    );
    await prisma.user.create({
      data: {
        name: "All Routes Super Admin",
        email: superAdminEmail,
        passwordHash: await hashPass(password),
        role: "SUPER_ADMIN",
      },
    });
    let superAdminToken = "";

    const login = check(
      "POST /api/auth/login",
      await agent.post("/api/auth/login").send({
        email: superAdminEmail,
        password,
      }),
      200
    );
    superAdminToken = login.body.data.accessToken as string;

    const refresh = check(
      "POST /api/auth/refresh",
      await agent.post("/api/auth/refresh"),
      200
    );
    expect(refresh.body.data.accessToken).toEqual(expect.any(String));

    check(
      "GET /api/auth/me",
      await agent.get("/api/auth/me").set(auth(superAdminToken)),
      200
    );

    check(
      "GET /api/users",
      await agent.get("/api/users").set(auth(superAdminToken)),
      200
    );

    const salon = check(
      "POST /api/salons",
      await agent
        .post("/api/salons")
        .set(auth(superAdminToken))
        .send({
          name: `All Routes Salon ${stamp}`,
          email: `all-routes-salon-${stamp}@example.com`,
          phone: "9100000001",
          addressLine1: "Test Street",
          city: "Mumbai",
          state: "MH",
          postalCode: "400001",
        }),
      201
    );
    const salonId = salon.body.data.id as string;

    const salons = check(
      "GET /api/salons",
      await agent.get("/api/salons").set(auth(superAdminToken)),
      200
    );
    expect(
      salons.body.data.map((item: { id: string }) => item.id)
    ).toContain(salonId);

    const disposableBranch = check(
      "POST /api/branches",
      await agent
        .post("/api/branches")
        .set(auth(superAdminToken))
        .send({
          name: `Disposable Branch ${stamp}`,
          salonId,
          city: "Mumbai",
        }),
      201
    );
    const disposableBranchId = disposableBranch.body.data.id as string;

    check(
      "GET /api/branches/:id",
      await agent
        .get(`/api/branches/${disposableBranchId}`)
        .set(auth(superAdminToken)),
      200
    );

    const updatedBranch = check(
      "PUT /api/branches/:id",
      await agent
        .put(`/api/branches/${disposableBranchId}`)
        .set(auth(superAdminToken))
        .send({
          name: `Disposable Branch Updated ${stamp}`,
          city: "Pune",
        }),
      200
    );
    expect(updatedBranch.body.data.city).toBe("Pune");

    check(
      "DELETE /api/branches/:id",
      await agent
        .delete(`/api/branches/${disposableBranchId}`)
        .set(auth(superAdminToken)),
      200
    );

    const branch = await agent
      .post("/api/branches")
      .set(auth(superAdminToken))
      .send({
        name: `Main Branch ${stamp}`,
        salonId,
        city: "Mumbai",
      });
    expect(branch.status).toBe(201);
    const branchId = branch.body.data.id as string;

    const branches = check(
      "GET /api/branches",
      await agent.get("/api/branches").set(auth(superAdminToken)),
      200
    );
    expect(
      branches.body.data.map((item: { id: string }) => item.id)
    ).toContain(branchId);

    const salonAdminEmail = `all-routes-admin-${stamp}@example.com`;
    check(
      "POST /api/users/salon-admin",
      await agent
        .post("/api/users/salon-admin")
        .set(auth(superAdminToken))
        .send({
          name: "All Routes Salon Admin",
          email: salonAdminEmail,
          phone_number: "9000000002",
          password,
          salonId,
        }),
      201
    );

    const salonAdminLogin = await agent.post("/api/auth/login").send({
      email: salonAdminEmail,
      password,
    });
    expect(salonAdminLogin.status).toBe(200);
    const salonAdminToken = salonAdminLogin.body.data.accessToken as string;

    check(
      "POST /api/users/branch-manager",
      await agent
        .post("/api/users/branch-manager")
        .set(auth(superAdminToken))
        .send({
          name: "All Routes Branch Manager",
          email: `all-routes-manager-${stamp}@example.com`,
          phone_number: "9000000009",
          password,
          salonId,
          branchId,
        }),
      201
    );

    check(
      "POST /api/users/receptionist",
      await agent
        .post("/api/users/receptionist")
        .set(auth(superAdminToken))
        .send({
          name: "All Routes Receptionist",
          email: `all-routes-receptionist-${stamp}@example.com`,
          phone_number: "9000000003",
          password,
          salonId,
          branchId,
        }),
      201
    );

    const staff = check(
      "POST /api/staff",
      await agent
        .post("/api/staff")
        .set(auth(superAdminToken))
        .send({
          name: "Primary Stylist",
          email: `all-routes-staff-${stamp}@example.com`,
          phone: "9200000101",
          jobRole: "Stylist",
          workingFrom: "10:00",
          workingTo: "19:00",
          weekOff: "MONDAY",
          joiningDate: "2030-01-01T00:00:00.000Z",
          salonId,
          branchId,
        }),
      201
    );
    const staffId = staff.body.data.id as string;

    const staffAccount = check(
      "POST /api/users/staff",
      await agent
        .post("/api/users/staff")
        .set(auth(superAdminToken))
        .send({ staffId, password }),
      201
    );

    check(
      "PATCH /api/users/:id/status",
      await agent
        .patch(`/api/users/${staffAccount.body.data.id}/status`)
        .set(auth(superAdminToken))
        .send({ status: "ACTIVE" }),
      200
    );

    const staffList = check(
      "GET /api/staff",
      await agent.get("/api/staff").set(auth(superAdminToken)),
      200
    );
    expect(
      staffList.body.data.map((item: { id: string }) => item.id)
    ).toContain(staffId);

    check(
      "GET /api/staff/:id",
      await agent.get(`/api/staff/${staffId}`).set(auth(superAdminToken)),
      200
    );

    const staffUpdate = check(
      "PUT /api/staff/:id",
      await agent
        .put(`/api/staff/${staffId}`)
        .set(auth(superAdminToken))
        .send({
          name: "Primary Senior Stylist",
          email: `all-routes-staff-updated-${stamp}@example.com`,
          phone: "9200000101",
          jobRole: "Senior Stylist",
          workingFrom: "09:00",
          workingTo: "18:00",
          weekOff: "TUESDAY",
          branchId,
          reportingManagerId: null,
        }),
      200
    );
    expect(staffUpdate.body.data.jobRole).toBe("Senior Stylist");

    const staffStatus = check(
      "PATCH /api/staff/:id/status",
      await agent
        .patch(`/api/staff/${staffId}/status`)
        .set(auth(superAdminToken))
        .send({ status: false }),
      200
    );
    expect(staffStatus.body.data.status).toBe(false);

    await agent
      .patch(`/api/staff/${staffId}/status`)
      .set(auth(superAdminToken))
      .send({ status: true })
      .expect(200);

    const disposableStaff = await agent
      .post("/api/staff")
      .set(auth(superAdminToken))
      .send({
        name: "Disposable Stylist",
        email: `all-routes-disposable-staff-${stamp}@example.com`,
        phone: "9200000202",
        jobRole: "Stylist",
        workingFrom: "10:00",
        workingTo: "19:00",
        weekOff: "WEDNESDAY",
        joiningDate: "2030-01-02T00:00:00.000Z",
        salonId,
        branchId,
      });
    expect(disposableStaff.status).toBe(201);

    check(
      "DELETE /api/staff/:id",
      await agent
        .delete(`/api/staff/${disposableStaff.body.data.id}`)
        .set(auth(superAdminToken)),
      200
    );

    const customer = check(
      "POST /api/customers",
      await agent
        .post("/api/customers")
        .set(auth(superAdminToken))
        .send({
          name: "Primary Customer",
          phone: "9300000001",
          email: `all-routes-customer-${stamp}@example.com`,
          salonId,
          branchId,
        }),
      201
    );
    const customerId = customer.body.data.id as string;

    const customers = check(
      "GET /api/customers",
      await agent.get("/api/customers").set(auth(superAdminToken)),
      200
    );
    expect(
      customers.body.data.map((item: { id: string }) => item.id)
    ).toContain(customerId);

    check(
      "GET /api/customers/:id",
      await agent
        .get(`/api/customers/${customerId}`)
        .set(auth(superAdminToken)),
      200
    );

    const customerUpdate = check(
      "PUT /api/customers/:id",
      await agent
        .put(`/api/customers/${customerId}`)
        .set(auth(superAdminToken))
        .send({
          name: "Primary Customer Updated",
          customNotes: "All-routes test",
          status: "PREMIUM",
        }),
      200
    );
    expect(customerUpdate.body.data.status).toBe("PREMIUM");

    const membership = check(
      "POST /api/memberships",
      await agent
        .post("/api/memberships")
        .set(auth(superAdminToken))
        .send({
          salonId,
          name: `All Routes Gold ${stamp}`,
          discountPercentage: 10,
        }),
      201
    );
    const membershipId = membership.body.data.id as string;

    const memberships = check(
      "GET /api/memberships",
      await agent
        .get(`/api/memberships?salonId=${salonId}`)
        .set(auth(superAdminToken)),
      200
    );
    expect(
      memberships.body.data.map((item: { id: string }) => item.id)
    ).toContain(membershipId);

    check(
      "GET /api/memberships/:id",
      await agent
        .get(`/api/memberships/${membershipId}`)
        .set(auth(superAdminToken)),
      200
    );

    const membershipUpdate = check(
      "PUT /api/memberships/:id",
      await agent
        .put(`/api/memberships/${membershipId}`)
        .set(auth(superAdminToken))
        .send({
          name: `All Routes Gold Plus ${stamp}`,
          description: "Updated by all-routes test",
          discountPercentage: 15,
        }),
      200
    );
    expect(Number(membershipUpdate.body.data.discountPercentage)).toBe(15);

    const membershipStatus = check(
      "PATCH /api/memberships/:id/status",
      await agent
        .patch(`/api/memberships/${membershipId}/status`)
        .set(auth(superAdminToken))
        .send({
          status: false,
        }),
      200
    );
    expect(membershipStatus.body.data.status).toBe(false);

    await agent
      .patch(`/api/memberships/${membershipId}/status`)
      .set(auth(superAdminToken))
      .send({
        status: true,
      })
      .expect(200);

    const customerMembership = check(
      "PATCH /api/customers/:id/membership",
      await agent
        .patch(`/api/customers/${customerId}/membership`)
        .set(auth(superAdminToken))
        .send({
          membershipId,
        }),
      200
    );
    expect(customerMembership.body.data.membershipId).toBe(membershipId);

    const disposableMembership = await agent
      .post("/api/memberships")
      .set(auth(superAdminToken))
      .send({
        salonId,
        name: `Disposable Membership ${stamp}`,
      });
    expect(disposableMembership.status).toBe(201);

    check(
      "DELETE /api/memberships/:id",
      await agent
        .delete(`/api/memberships/${disposableMembership.body.data.id}`)
        .set(auth(superAdminToken)),
      200
    );

    const loyaltyRule = check(
      "POST /api/loyalty-rules",
      await agent
        .post("/api/loyalty-rules")
        .set(auth(superAdminToken))
        .send({
          salonId,
        }),
      201
    );
    const loyaltyRuleId = loyaltyRule.body.data.id as string;

    const loyaltyRules = check(
      "GET /api/loyalty-rules",
      await agent
        .get(`/api/loyalty-rules?salonId=${salonId}`)
        .set(auth(superAdminToken)),
      200
    );
    expect(
      loyaltyRules.body.data.map((item: { id: string }) => item.id)
    ).toContain(loyaltyRuleId);

    check(
      "GET /api/loyalty-rules/active",
      await agent
        .get(`/api/loyalty-rules/active?salonId=${salonId}`)
        .set(auth(superAdminToken)),
      200
    );

    check(
      "GET /api/loyalty-rules/:id",
      await agent
        .get(`/api/loyalty-rules/${loyaltyRuleId}`)
        .set(auth(superAdminToken)),
      200
    );

    const loyaltyRuleUpdate = check(
      "PUT /api/loyalty-rules/:id",
      await agent
        .put(`/api/loyalty-rules/${loyaltyRuleId}`)
        .set(auth(superAdminToken))
        .send({
          earnAmountStep: 200,
          earnPointsPerAmount: 3,
          redeemValuePerPoint: 2,
          minRedeemPoints: 20,
          maxRedeemPoints: 200,
        }),
      200
    );
    expect(Number(loyaltyRuleUpdate.body.data.earnAmountStep)).toBe(200);

    const loyaltyRuleStatus = check(
      "PATCH /api/loyalty-rules/:id/status",
      await agent
        .patch(`/api/loyalty-rules/${loyaltyRuleId}/status`)
        .set(auth(superAdminToken))
        .send({
          status: false,
        }),
      200
    );
    expect(loyaltyRuleStatus.body.data.status).toBe(false);

    await agent
      .patch(`/api/loyalty-rules/${loyaltyRuleId}/status`)
      .set(auth(superAdminToken))
      .send({
        status: true,
      })
      .expect(200);

    const loyaltyAdjustment = check(
      "POST /api/loyalty/customers/:customerId/adjust",
      await agent
        .post(`/api/loyalty/customers/${customerId}/adjust`)
        .set(auth(superAdminToken))
        .send({
          points: 20,
          note: "All-routes adjustment",
        }),
      200
    );
    expect(loyaltyAdjustment.body.data.customer.loyaltyPoints).toBe(20);

    const loyaltyHistory = check(
      "GET /api/loyalty/customers/:customerId/transactions",
      await agent
        .get(`/api/loyalty/customers/${customerId}/transactions`)
        .set(auth(superAdminToken)),
      200
    );
    expect(loyaltyHistory.body.data.transactions).toHaveLength(1);

    const wallet = check(
      "POST /api/customers/:id/wallet/add",
      await agent
        .post(`/api/customers/${customerId}/wallet/add`)
        .set(auth(superAdminToken))
        .send({ amount: 250, narration: "Route coverage wallet credit" }),
      200
    );
    expect(Number(wallet.body.data.customer.walletBalance)).toBe(250);

    const transactions = check(
      "GET /api/customers/:id/transactions",
      await agent
        .get(`/api/customers/${customerId}/transactions`)
        .set(auth(superAdminToken)),
      200
    );
    expect(transactions.body.data).toHaveLength(1);

    const disposableCustomer = await agent
      .post("/api/customers")
      .set(auth(superAdminToken))
      .send({
        name: "Disposable Customer",
        phone: "9300000002",
        salonId,
        branchId,
      });
    expect(disposableCustomer.status).toBe(201);

    check(
      "DELETE /api/customers/:id",
      await agent
        .delete(`/api/customers/${disposableCustomer.body.data.id}`)
        .set(auth(superAdminToken)),
      200
    );

    const seededDefaults = check(
      "POST /api/services/seed-defaults",
      await agent
        .post("/api/services/seed-defaults")
        .set(auth(salonAdminToken))
        .send({}),
      200
    );
    expect(seededDefaults.body.data).toEqual({
      mainServicesCreated: 8,
      servicesCreated: 32,
      skippedExisting: 0,
    });

    const seededDefaultsAgain = await agent
      .post("/api/services/seed-defaults")
      .set(auth(salonAdminToken))
      .send({});
    expect(seededDefaultsAgain.status).toBe(200);
    expect(seededDefaultsAgain.body.data).toEqual({
      mainServicesCreated: 0,
      servicesCreated: 0,
      skippedExisting: 32,
    });

    const mainService = check(
      "POST /api/main-services",
      await agent
        .post("/api/main-services")
        .set(auth(superAdminToken))
        .send({
          name: `Hair ${stamp}`,
          salonId,
        }),
      201
    );
    const mainServiceId = mainService.body.data.id as string;

    const mainServices = check(
      "GET /api/main-services",
      await agent.get("/api/main-services").set(auth(superAdminToken)),
      200
    );
    expect(
      mainServices.body.data.map((item: { id: string }) => item.id)
    ).toContain(mainServiceId);

    check(
      "GET /api/main-services/:id",
      await agent
        .get(`/api/main-services/${mainServiceId}`)
        .set(auth(superAdminToken)),
      200
    );

    const mainServiceUpdate = check(
      "PUT /api/main-services/:id",
      await agent
        .put(`/api/main-services/${mainServiceId}`)
        .set(auth(superAdminToken))
        .send({ name: `Hair Updated ${stamp}` }),
      200
    );
    expect(mainServiceUpdate.body.data.name).toBe(`Hair Updated ${stamp}`);

    const mainServiceStatus = check(
      "PATCH /api/main-services/:id/status",
      await agent
        .patch(`/api/main-services/${mainServiceId}/status`)
        .set(auth(superAdminToken))
        .send({ status: false }),
      200
    );
    expect(mainServiceStatus.body.data.status).toBe(false);

    await agent
      .patch(`/api/main-services/${mainServiceId}/status`)
      .set(auth(superAdminToken))
      .send({ status: true })
      .expect(200);

    const disposableMainService = await agent
      .post("/api/main-services")
      .set(auth(superAdminToken))
      .send({
        name: `Disposable Main Service ${stamp}`,
        salonId,
      });
    expect(disposableMainService.status).toBe(201);

    check(
      "DELETE /api/main-services/:id",
      await agent
        .delete(`/api/main-services/${disposableMainService.body.data.id}`)
        .set(auth(superAdminToken)),
      200
    );

    const otherSalon = await agent
      .post("/api/salons")
      .set(auth(superAdminToken))
      .send({ name: `Other Tenant Salon ${stamp}` });
    expect(otherSalon.status).toBe(201);

    const otherMainService = await agent
      .post("/api/main-services")
      .set(auth(superAdminToken))
      .send({
        name: `Other Tenant Hair ${stamp}`,
        salonId: otherSalon.body.data.id,
      });
    expect(otherMainService.status).toBe(201);

    const crossTenantService = await agent
      .post("/api/services")
      .set(auth(salonAdminToken))
      .send({
        name: `Cross Tenant Service ${stamp}`,
        price: 100,
        mainServiceId: otherMainService.body.data.id,
        salonId: otherSalon.body.data.id,
      });
    expect(crossTenantService.status).toBe(400);
    expect(crossTenantService.body.message).toBe(
      "Invalid main service for this salon"
    );

    const service = check(
      "POST /api/services",
      await agent
        .post("/api/services")
        .set(auth(superAdminToken))
        .send({
          name: `Haircut ${stamp}`,
          description: "Primary service",
          price: 500,
          durationValue: 60,
          durationUnit: "MINUTES",
          salonId,
          branchId,
          mainServiceId,
        }),
      201
    );
    const serviceId = service.body.data.id as string;

    const services = check(
      "GET /api/services",
      await agent.get("/api/services").set(auth(superAdminToken)),
      200
    );
    expect(
      services.body.data.map((item: { id: string }) => item.id)
    ).toContain(serviceId);

    check(
      "GET /api/services/:id",
      await agent
        .get(`/api/services/${serviceId}`)
        .set(auth(superAdminToken)),
      200
    );

    const serviceUpdate = check(
      "PUT /api/services/:id",
      await agent
        .put(`/api/services/${serviceId}`)
        .set(auth(superAdminToken))
        .send({
          name: `Premium Haircut ${stamp}`,
          description: "Updated primary service",
          price: 600,
          durationValue: 90,
          durationUnit: "MINUTES",
          branchId,
          mainServiceId,
        }),
      200
    );
    expect(Number(serviceUpdate.body.data.price)).toBe(600);

    const serviceStatus = check(
      "PATCH /api/services/:id/status",
      await agent
        .patch(`/api/services/${serviceId}/status`)
        .set(auth(superAdminToken))
        .send({ status: false }),
      200
    );
    expect(serviceStatus.body.data.status).toBe(false);

    const inactiveServiceAppointment = await agent
      .post("/api/appointments")
      .set(auth(superAdminToken))
      .send({
        salonId,
        branchId,
        customerId,
        staffId,
        serviceIds: [serviceId],
        startTime: "2034-01-01T10:00:00.000Z",
      });
    expect(inactiveServiceAppointment.status).toBe(400);

    await agent
      .patch(`/api/services/${serviceId}/status`)
      .set(auth(superAdminToken))
      .send({ status: true })
      .expect(200);

    const disposableService = await agent
      .post("/api/services")
      .set(auth(superAdminToken))
      .send({
        name: `Disposable Service ${stamp}`,
        price: 100,
        durationValue: 15,
        durationUnit: "MINUTES",
        salonId,
        branchId,
        mainServiceId,
      });
    expect(disposableService.status).toBe(201);

    check(
      "DELETE /api/services/:id",
      await agent
        .delete(`/api/services/${disposableService.body.data.id}`)
        .set(auth(superAdminToken)),
      200
    );

    const appointment = check(
      "POST /api/appointments",
      await agent
        .post("/api/appointments")
        .set(auth(superAdminToken))
        .send({
          salonId,
          branchId,
          customerId,
          staffId,
          serviceIds: [serviceId],
          startTime: "2035-01-03T10:00:00.000Z",
          bookingNote: "Initial booking note",
        }),
      201
    );
    const appointmentId = appointment.body.data.id as string;

    const appointments = check(
      "GET /api/appointments",
      await agent.get("/api/appointments").set(auth(superAdminToken)),
      200
    );
    expect(
      appointments.body.data.map((item: { id: string }) => item.id)
    ).toContain(appointmentId);

    check(
      "GET /api/appointments/:id",
      await agent
        .get(`/api/appointments/${appointmentId}`)
        .set(auth(superAdminToken)),
      200
    );

    const appointmentUpdate = check(
      "PUT /api/appointments/:id",
      await agent
        .put(`/api/appointments/${appointmentId}`)
        .set(auth(superAdminToken))
        .send({
          bookingNote: "Updated booking note",
          internalNote: "Updated internal note",
        }),
      200
    );
    expect(appointmentUpdate.body.data.bookingNote).toBe(
      "Updated booking note"
    );

    const reschedule = check(
      "PATCH /api/appointments/:id/reschedule",
      await agent
        .patch(`/api/appointments/${appointmentId}/reschedule`)
        .set(auth(superAdminToken))
        .send({ startTime: "2035-01-03T11:00:00.000Z" }),
      200
    );
    expect(new Date(reschedule.body.data.startTime).toISOString()).toBe(
      "2035-01-03T11:00:00.000Z"
    );

    for (const status of ["CONFIRMED", "CHECKED_IN", "COMPLETED"]) {
      const statusResponse = await agent
        .patch(`/api/appointments/${appointmentId}/status`)
        .set(auth(superAdminToken))
        .send({ status, note: `Moved to ${status}` });

      if (status === "CONFIRMED") {
        check(
          "PATCH /api/appointments/:id/status",
          statusResponse,
          200
        );
      } else {
        expect(statusResponse.status).toBe(200);
      }
    }

    const tracking = check(
      "GET /api/appointments/:id/tracking",
      await agent
        .get(`/api/appointments/${appointmentId}/tracking`)
        .set(auth(superAdminToken)),
      200
    );
    expect(tracking.body.data).toHaveLength(3);

    const disposableAppointment = await agent
      .post("/api/appointments")
      .set(auth(superAdminToken))
      .send({
        salonId,
        branchId,
        customerId,
        staffId,
        serviceIds: [serviceId],
        startTime: "2035-01-04T10:00:00.000Z",
      });
    expect(disposableAppointment.status).toBe(201);

    check(
      "DELETE /api/appointments/:id",
      await agent
        .delete(`/api/appointments/${disposableAppointment.body.data.id}`)
        .set(auth(superAdminToken)),
      200
    );

    const invoice = check(
      "POST /api/invoices/from-appointment/:appointmentId",
      await agent
        .post(`/api/invoices/from-appointment/${appointmentId}`)
        .set(auth(superAdminToken))
        .send({
          invoiceType: "GST_INVOICE",
          taxPercent: 18,
          discountAmount: 50,
          processingFeeAmount: 10,
        }),
      201
    );
    const invoiceId = invoice.body.data.id as string;

    const redemption = check(
      "POST /api/invoices/:id/redeem-loyalty",
      await agent
        .post(`/api/invoices/${invoiceId}/redeem-loyalty`)
        .set(auth(superAdminToken))
        .send({
          points: 20,
        }),
      200
    );
    expect(redemption.body.data.customer.loyaltyPoints).toBe(0);

    const invoices = check(
      "GET /api/invoices",
      await agent.get("/api/invoices").set(auth(superAdminToken)),
      200
    );
    expect(
      invoices.body.data.map((item: { id: string }) => item.id)
    ).toContain(invoiceId);

    check(
      "GET /api/invoices/:id",
      await agent
        .get(`/api/invoices/${invoiceId}`)
        .set(auth(superAdminToken)),
      200
    );

    const payment = check(
      "POST /api/payments",
      await agent
        .post("/api/payments")
        .set(auth(superAdminToken))
        .send({
          invoiceId,
          amount: 100,
          method: "UPI",
          referenceNo: "ALL-ROUTES-001",
        }),
      201
    );
    const paymentId = payment.body.data.payment.id as string;

    const payments = check(
      "GET /api/payments",
      await agent.get("/api/payments").set(auth(superAdminToken)),
      200
    );
    expect(
      payments.body.data.map((item: { id: string }) => item.id)
    ).toContain(paymentId);

    check(
      "GET /api/payments/:id",
      await agent
        .get(`/api/payments/${paymentId}`)
        .set(auth(superAdminToken)),
      200
    );

    const cancelAppointment = await agent
      .post("/api/appointments")
      .set(auth(superAdminToken))
      .send({
        salonId,
        branchId,
        customerId,
        staffId,
        serviceIds: [serviceId],
        startTime: "2035-01-05T10:00:00.000Z",
      });
    expect(cancelAppointment.status).toBe(201);

    for (const status of ["CONFIRMED", "CHECKED_IN", "COMPLETED"]) {
      await agent
        .patch(`/api/appointments/${cancelAppointment.body.data.id}/status`)
        .set(auth(superAdminToken))
        .send({ status })
        .expect(200);
    }

    await new Promise((resolve) => setTimeout(resolve, 5));

    const cancellableInvoice = await agent
      .post(
        `/api/invoices/from-appointment/${cancelAppointment.body.data.id}`
      )
      .set(auth(superAdminToken))
      .send({ invoiceType: "BILL_OF_SUPPLY" });
    expect(cancellableInvoice.status).toBe(201);

    const cancelledInvoice = check(
      "PATCH /api/invoices/:id/cancel",
      await agent
        .patch(`/api/invoices/${cancellableInvoice.body.data.id}/cancel`)
        .set(auth(superAdminToken)),
      200
    );
    expect(cancelledInvoice.body.data.status).toBe("CANCELLED");

    check(
      "POST /api/auth/logout",
      await agent
        .post("/api/auth/logout")
        .set(auth(superAdminToken)),
      200
    );

    const refreshAfterLogout = await agent.post("/api/auth/refresh");
    expect(refreshAfterLogout.status).toBe(401);

    expect([...testedRoutes].sort()).toEqual([...ALL_ROUTES].sort());
  });
});
