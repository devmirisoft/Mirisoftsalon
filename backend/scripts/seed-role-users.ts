import "dotenv/config";

import { prisma } from "../src/config/prisma.js";
import { SalonModel } from "../src/features/salons/salon.model.js";
import { buildSalonCode } from "../src/utils/business-id.js";
import { hashPass } from "../src/utils/password.js";

const accounts = [
  {
    role: "SUPER_ADMIN" as const,
    name: "Test Super Admin",
    email: "test_superadmin@test.com",
    password: "testsuperadmin",
  },
  {
    role: "SALON_ADMIN" as const,
    name: "Test Salon Admin",
    email: "test_admin@test.com",
    password: "testadmin",
  },
  {
    role: "BRANCH_MANAGER" as const,
    name: "Test Branch Manager",
    email: "test_manager@test.com",
    password: "testmanager",
  },
  {
    role: "RECEPTIONIST" as const,
    name: "Test Receptionist",
    email: "test_receptionist@test.com",
    password: "testreceptionist",
  },
  {
    role: "STAFF" as const,
    name: "Test Staff",
    email: "test_staff@test.com",
    password: "teststaff",
  },
];

const salonDetails = {
  name: "Test Salon",
  email: "hello@testsalon.com",
  phone: "9000000001",
  addressLine1: "12 MG Road",
  city: "Bengaluru",
  state: "Karnataka",
  postalCode: "560001",
  timezone: "Asia/Kolkata",
};

const branchDetails = {
  name: "Test Branch",
  addressLine1: "12 MG Road",
  city: "Bengaluru",
  state: "Karnataka",
  postalCode: "560001",
  phone: "9000000002",
  email: "branch@testsalon.com",
  openingTime: "10:00",
  closingTime: "20:00",
};

const main = async () => {
  let salon = await prisma.salon.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (!salon) {
    salon = await SalonModel.create(salonDetails);
  }

  // Salons seeded before this filled in only `name`, so backfill the rest.
  if (!salon.salonCode) {
    salon = await prisma.salon.update({
      where: { id: salon.id },
      data: {
        ...salonDetails,
        name: salon.name,
        salonCode: buildSalonCode({
          salonName: salon.name,
          timezone: salon.timezone,
        }),
      },
    });
  }

  let branch = await prisma.branch.findFirst({
    where: { salonId: salon.id },
    orderBy: { createdAt: "asc" },
  });

  if (!branch) {
    branch = await prisma.branch.create({
      data: { ...branchDetails, salonId: salon.id },
    });
  }

  if (!branch.phone) {
    branch = await prisma.branch.update({
      where: { id: branch.id },
      data: { ...branchDetails, name: branch.name },
    });
  }

  for (const account of accounts) {
    const passwordHash = await hashPass(account.password);
    const needsSalon = account.role !== "SUPER_ADMIN";
    // Everything but SUPER_ADMIN gets a branch, matching what `register`
    // gives a real salon admin. SALON_ADMIN stays branch-unrestricted (its
    // scope comes from activeBranchId), but the branch profile screens read
    // user.branchId and 400 without one.
    const needsBranch = needsSalon;

    await prisma.user.upsert({
      where: { email: account.email },
      create: {
        name: account.name,
        email: account.email,
        passwordHash,
        role: account.role,
        ...(needsSalon ? { salonId: salon.id } : {}),
        ...(needsBranch ? { branchId: branch.id } : {}),
      },
      update: {
        name: account.name,
        passwordHash,
        role: account.role,
        salonId: needsSalon ? salon.id : null,
        branchId: needsBranch ? branch.id : null,
      },
    });
  }

  console.table(
    accounts.map(({ role, email, password }) => ({ role, email, password }))
  );
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

