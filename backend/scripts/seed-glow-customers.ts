/**
 * Creates 10 customers per branch for the Glow salon.
 *
 * Dry run by default; pass --yes to write. Codes, phones and emails are
 * derived from the branch/customer index so a re-run collides instead of
 * silently doubling the rows.
 *
 * Usage: tsx scripts/seed-glow-customers.ts [--salon "Glow"] [--yes]
 */
import "dotenv/config";

import { prisma } from "../src/config/prisma.js";

const PER_BRANCH = 10;

const args = process.argv.slice(2);
const write = args.includes("--yes");
const salonQuery = args[args.indexOf("--salon") + 1] ?? "Glow";

const firstNames = [
  "Priya", "Rahul", "Sana", "Vikram", "Anjali",
  "Karan", "Pooja", "Aditya", "Sneha", "Manish",
];
const surnames = [
  "Sharma", "Iyer", "Reddy", "Nair", "Kapoor",
  "Menon", "Joshi", "Desai", "Rao", "Bhatia",
];

const salon = await prisma.salon.findFirst({
  where: { name: { contains: salonQuery, mode: "insensitive" } },
  select: {
    id: true,
    name: true,
    branches: {
      where: { status: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    },
  },
});

if (!salon) throw new Error(`No salon matching "${salonQuery}"`);
if (!salon.branches.length) throw new Error(`${salon.name} has no active branches`);

const rows = salon.branches.flatMap((branch, b) =>
  Array.from({ length: PER_BRANCH }, (_, i) => {
    const seq = b * 100 + i;
    const name = `${firstNames[i % firstNames.length]} ${surnames[b % surnames.length]}`;

    return {
      salonId: salon.id,
      branchId: branch.id,
      customerCode: `ABM${810000 + seq}`,
      name,
      phone: String(9810000000 + seq),
      email: `${name.toLowerCase().replace(" ", ".")}.${seq}@example.com`,
    };
  })
);

// The unique keys are per-salon, so a partial previous run would make
// createMany skip rows and leave an uneven split. Bail instead.
const clash = await prisma.customer.findFirst({
  where: {
    salonId: salon.id,
    OR: [
      { customerCode: { in: rows.map((r) => r.customerCode) } },
      { phone: { in: rows.map((r) => r.phone) } },
      { email: { in: rows.map((r) => r.email) } },
    ],
  },
  select: { customerCode: true, name: true, phone: true },
});

if (clash) {
  throw new Error(
    `Already seeded (or code clash): ${clash.customerCode} ${clash.name} ${clash.phone}`
  );
}

console.log(`${salon.name} — ${salon.branches.length} active branches`);
for (const branch of salon.branches) {
  console.log(`  ${branch.name}: ${PER_BRANCH} customers`);
}

if (!write) {
  console.log(`\nDry run. ${rows.length} rows would be created. Re-run with --yes.`);
} else {
  const { count } = await prisma.customer.createMany({ data: rows });
  console.log(`\nCreated ${count} customers.`);
}

await prisma.$disconnect();
