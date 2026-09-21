import "dotenv/config";

import { prisma } from "../src/config/prisma.js";
import { SalonModel } from "../src/features/salons/salon.model.js";
import { hashPass } from "../src/utils/password.js";
import { assignCustomerMembershipHistory } from "../src/features/customer-memberships/customer-membership.service.js";
import { createPackageCategory, createServicePackage } from "../src/features/packages/package.service.js";

const SALON_NAME = "Glow Multi Salon";
const ADMIN = { email: "glow_admin@test.com", password: "glowadmin" };

const branches = [
  { name: "Glow Indiranagar", branchCode: "GLW-IND", city: "Bengaluru", phone: "9100000010" },
  { name: "Glow Koramangala", branchCode: "GLW-KOR", city: "Bengaluru", phone: "9100000020" },
  { name: "Glow Whitefield", branchCode: "GLW-WHF", city: "Bengaluru", phone: "9100000030" },
];

const roles = ["Hair Stylist", "Beautician", "Nail Artist", "Receptionist"];
const firstNames = [
  "Aarav", "Diya", "Kabir", "Meera",
  "Rohan", "Isha", "Arjun", "Tanya",
  "Vivaan", "Kavya", "Dev", "Nisha",
];
const customerFirstNames = [
  "Priya", "Rahul", "Sana", "Vikram", "Anjali",
  "Karan", "Pooja", "Aditya", "Sneha", "Manish",
];
const customerSurnames = ["Sharma", "Iyer", "Reddy"];

// Pay `price`, get `walletCreditAmount` to spend, plus a discount on every bill.
const membershipPlans = [
  { name: "Silver", description: "10% off services, ₹5,500 wallet for ₹5,000", discountPercentage: 10, durationMonths: 6, price: 5000, walletCreditAmount: 5500 },
  { name: "Gold", description: "15% off services, ₹12,000 wallet for ₹10,000", discountPercentage: 15, durationMonths: 12, price: 10000, walletCreditAmount: 12000 },
  { name: "Platinum", description: "20% off services, ₹25,000 wallet for ₹20,000", discountPercentage: 20, durationMonths: 12, price: 20000, walletCreditAmount: 25000 },
];

// Built on the salon's default services (Services > load defaults), which must exist.
// specialPrice must stay below the summed service prices (the app enforces it).
const packages = [
  { category: "Hair Care", name: "Hair Care Combo", description: "4 haircuts + 2 hair spas", specialPrice: 2600, validityDays: 90, items: [["Hair Cut", 4], ["Hair Spa", 2]] },
  { category: "Skin Care", name: "Glow Skin Pack", description: "3 basic facials + 3 cleanups", specialPrice: 3200, validityDays: 120, items: [["Basic Facial", 3], ["Cleanup", 3]] },
  { category: "Nail Care", name: "Mani-Pedi Pack", description: "5 manicures + 5 pedicures", specialPrice: 5000, validityDays: 180, items: [["Manicure", 5], ["Pedicure", 5]] },
] as const;

// Per branch, by customer index: who buys which plan / package. Last customer buys nothing.
const membershipFor = ["Silver", "Silver", "Silver", "Gold", "Gold", "Platinum", null, null, null, null];
const packageFor = [null, null, null, "Hair Care Combo", "Glow Skin Pack", "Mani-Pedi Pack", "Hair Care Combo", "Glow Skin Pack", "Mani-Pedi Pack", null];

const main = async () => {
  const salon =
    (await prisma.salon.findFirst({ where: { name: SALON_NAME } })) ??
    (await SalonModel.create({
      name: SALON_NAME,
      email: "hello@glowsalon.com",
      phone: "9100000001",
      addressLine1: "100 Ring Road",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
    }));

  for (const [b, details] of branches.entries()) {
    const branch = await prisma.branch.upsert({
      where: { salonId_name: { salonId: salon.id, name: details.name } },
      create: {
        ...details,
        salonId: salon.id,
        state: "Karnataka",
        email: `${details.branchCode.toLowerCase()}@glowsalon.com`,
        openingTime: "10:00",
        closingTime: "20:00",
      },
      update: {},
    });

    for (const [i, jobRole] of roles.entries()) {
      const n = b * roles.length + i + 1;
      const first = firstNames[n - 1];
      await prisma.staff.upsert({
        where: { salonId_email: { salonId: salon.id, email: `${first.toLowerCase()}@glowsalon.com` } },
        create: {
          name: `${first} ${details.branchCode.slice(-3)}`,
          email: `${first.toLowerCase()}@glowsalon.com`,
          phone: `91000001${String(n).padStart(2, "0")}`,
          jobRole,
          staffCode: `GLW-${String(n).padStart(3, "0")}`,
          workingFrom: "10:00",
          workingTo: "19:00",
          weekOff: "Monday",
          salonId: salon.id,
          branchId: branch.id,
        },
        update: {},
      });
    }

    for (const [i, first] of customerFirstNames.entries()) {
      const n = String(b * customerFirstNames.length + i + 1).padStart(2, "0");
      const phone = `98700000${n}`;
      await prisma.customer.upsert({
        where: { salonId_phone: { salonId: salon.id, phone } },
        create: {
          customerCode: `ABM9870${n}`,
          name: `${first} ${customerSurnames[b]}`,
          phone,
          email: `${first.toLowerCase()}.${customerSurnames[b].toLowerCase()}@test.com`,
          salonId: salon.id,
          branchId: branch.id,
        },
        update: {},
      });
    }
  }

  const firstBranch = await prisma.branch.findFirstOrThrow({
    where: { salonId: salon.id },
    orderBy: { createdAt: "asc" },
  });
  const admin = await prisma.user.upsert({
    where: { email: ADMIN.email },
    create: {
      name: "Glow Salon Admin",
      email: ADMIN.email,
      passwordHash: await hashPass(ADMIN.password),
      role: "SALON_ADMIN",
      salonId: salon.id,
      branchId: firstBranch.id,
    },
    update: {},
  });
  const actor = { userId: admin.id, role: "SALON_ADMIN", salonId: salon.id };
  const audit = {};

  const serviceIds = new Map(
    (await prisma.service.findMany({ where: { salonId: salon.id }, select: { id: true, name: true } })).map((s) => [s.name, s.id])
  );

  const plans = new Map<string, string>();
  for (const plan of membershipPlans) {
    const row = await prisma.membership.upsert({
      where: { salonId_name: { salonId: salon.id, name: plan.name } },
      create: { ...plan, salonId: salon.id },
      update: {},
    });
    plans.set(plan.name, row.id);
  }

  // Packages go through the app's service so price/item rules are enforced.
  for (const pkg of packages) {
    if (await prisma.servicePackage.findFirst({ where: { salonId: salon.id, name: pkg.name } })) continue;
    const category =
      (await prisma.packageCategory.findFirst({ where: { salonId: salon.id, name: pkg.category } })) ??
      (await createPackageCategory(actor, { name: pkg.category }, audit));
    await createServicePackage(
      actor,
      {
        categoryId: category.id,
        name: pkg.name,
        description: pkg.description,
        specialPrice: pkg.specialPrice,
        validityDays: pkg.validityDays,
        items: pkg.items.map(([name, quantity]) => {
          const serviceId = serviceIds.get(name);
          if (!serviceId) throw new Error(`Service "${name}" missing — load the default services first`);
          return { serviceId, quantity };
        }),
      },
      audit
    );
  }
  const servicePackages = await prisma.servicePackage.findMany({
    where: { salonId: salon.id, type: "STANDARD" },
    include: { items: true },
  });

  // Sell plans and packages to customers, credited by a branch staff member.
  for (const branch of await prisma.branch.findMany({ where: { salonId: salon.id } })) {
    const seller = await prisma.staff.findFirstOrThrow({ where: { branchId: branch.id }, orderBy: { staffCode: "asc" } });
    const branchCustomers = await prisma.customer.findMany({
      where: { branchId: branch.id, phone: { startsWith: "987" } },
      orderBy: { phone: "asc" },
    });

    for (const [i, customer] of branchCustomers.entries()) {
      const planName = membershipFor[i];
      const plan = planName && membershipPlans.find((p) => p.name === planName)!;
      if (plan && !(await prisma.customerMembership.findFirst({ where: { customerId: customer.id } }))) {
        await assignCustomerMembershipHistory(
          actor,
          customer.id,
          { membershipId: plans.get(plan.name)!, paymentMethod: "UPI", amountPaid: plan.price, soldByStaffId: seller.id, note: "Seeded" },
          audit
        );
      }

      const pkg = servicePackages.find((p) => p.name === packageFor[i]);
      if (pkg && !(await prisma.customerPackage.findFirst({ where: { customerId: customer.id } }))) {
        // Mirrors the invoice sale path (invoice.controller.ts), minus the invoice.
        const purchasedAt = new Date();
        const validUntil = new Date(purchasedAt);
        validUntil.setUTCDate(validUntil.getUTCDate() + pkg.validityDays);
        await prisma.customerPackage.create({
          data: {
            salonId: salon.id,
            branchId: branch.id,
            customerId: customer.id,
            packageId: pkg.id,
            packageNameSnapshot: pkg.name,
            totalPriceSnapshot: pkg.totalPrice,
            specialPriceSnapshot: pkg.specialPrice,
            validityDaysSnapshot: pkg.validityDays,
            maxRedemptionsSnapshot: pkg.maxRedemptions,
            purchasedAt,
            validUntil,
            soldByStaffId: seller.id,
            createdById: admin.id,
            serviceBalances: {
              create: pkg.items.map((item) => ({
                salonId: salon.id,
                branchId: branch.id,
                customerId: customer.id,
                packageId: pkg.id,
                serviceId: item.serviceId,
                serviceNameSnapshot: item.serviceNameSnapshot,
                includedQuantity: item.quantity,
                priceSnapshot: item.priceSnapshot,
                durationMinutesSnapshot: item.durationMinutesSnapshot,
              })),
            },
          },
        });
      }
    }
  }

  const result = await prisma.branch.findMany({
    where: { salonId: salon.id },
    select: {
      name: true,
      branchCode: true,
      _count: { select: { staff: true, customers: true, customerMemberships: true, customerPackages: true } },
    },
  });
  console.log(`Salon: ${salon.name} (${salon.salonCode})  admin login: ${ADMIN.email} / ${ADMIN.password}`);
  console.table(
    result.map((r) => ({
      branch: r.name,
      code: r.branchCode,
      staff: r._count.staff,
      customers: r._count.customers,
      memberships: r._count.customerMemberships,
      packages: r._count.customerPackages,
    }))
  );
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(); // the pg pool keeps the process alive otherwise
  });
