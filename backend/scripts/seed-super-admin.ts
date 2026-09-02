import "dotenv/config";

import { prisma } from "../src/config/prisma.js";
import { hashPass } from "../src/utils/password.js";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const main = async () => {
  const name = required("SUPER_ADMIN_NAME");
  const email = required("SUPER_ADMIN_EMAIL").toLowerCase();
  const password = required("SUPER_ADMIN_PASSWORD");

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      name,
      email,
      passwordHash: await hashPass(password),
      role: "SUPER_ADMIN",
    },
    update: {
      name,
      passwordHash: await hashPass(password),
      role: "SUPER_ADMIN",
      salonId: null,
      branchId: null,
      status: "ACTIVE",
    },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
    },
  });

  console.log(`SUPER_ADMIN ready`);
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
