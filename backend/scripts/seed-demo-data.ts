import "dotenv/config";

import { prisma } from "../src/config/prisma.js";

const catalog = [
  {
    mainService: "Hair",
    services: [
      { name: "Haircut", price: 400, durationValue: 30 },
      { name: "Hair Spa", price: 1200, durationValue: 60 },
      { name: "Hair Colour", price: 2500, durationValue: 90 },
    ],
  },
  {
    mainService: "Skin",
    services: [
      { name: "Clean Up", price: 800, durationValue: 45 },
      { name: "Facial", price: 1500, durationValue: 60 },
    ],
  },
  {
    mainService: "Nails",
    services: [
      { name: "Manicure", price: 600, durationValue: 45 },
      { name: "Pedicure", price: 700, durationValue: 45 },
    ],
  },
];

const staffMembers = [
  { name: "Asha Verma", email: "asha@test.com", phone: "9000000101", jobRole: "Hair Stylist" },
  { name: "Ravi Kumar", email: "ravi@test.com", phone: "9000000102", jobRole: "Beautician" },
  { name: "Neha Singh", email: "neha@test.com", phone: "9000000103", jobRole: "Nail Artist" },
];

const customers = [
  { customerCode: "ABM100001", name: "Priya Sharma", phone: "9800000001", email: "priya@test.com" },
  { customerCode: "ABM100002", name: "Rahul Mehta", phone: "9800000002", email: "rahul@test.com" },
  { customerCode: "ABM100003", name: "Sana Khan", phone: "9800000003", email: "sana@test.com" },
  { customerCode: "ABM100004", name: "Vikram Rao", phone: "9800000004", email: "vikram@test.com" },
];

const main = async () => {
  const salon = await prisma.salon.findFirst({ orderBy: { createdAt: "asc" } });
  if (!salon) throw new Error("No salon found. Run `npm run seed:roles` first.");

  const branch = await prisma.branch.findFirst({
    where: { salonId: salon.id },
    orderBy: { createdAt: "asc" },
  });
  if (!branch) throw new Error("No branch found. Run `npm run seed:roles` first.");

  const scope = { salonId: salon.id, branchId: branch.id };

  for (const group of catalog) {
    const mainService = await prisma.mainService.upsert({
      where: { salonId_name: { salonId: salon.id, name: group.mainService } },
      create: { name: group.mainService, salonId: salon.id },
      update: {},
    });

    for (const service of group.services) {
      await prisma.service.upsert({
        where: {
          salonId_mainServiceId_name: {
            salonId: salon.id,
            mainServiceId: mainService.id,
            name: service.name,
          },
        },
        create: { ...service, ...scope, mainServiceId: mainService.id },
        update: { price: service.price, durationValue: service.durationValue },
      });
    }
  }

  for (const member of staffMembers) {
    await prisma.staff.upsert({
      where: { salonId_email: { salonId: salon.id, email: member.email } },
      create: {
        ...member,
        ...scope,
        staffCode: `DEMO-${member.phone.slice(-3)}`,
        workingFrom: "10:00",
        workingTo: "19:00",
        weekOff: "Monday",
      },
      update: {},
    });
  }

  for (const customer of customers) {
    await prisma.customer.upsert({
      where: { salonId_phone: { salonId: salon.id, phone: customer.phone } },
      create: { ...customer, ...scope },
      update: {},
    });
  }

  console.table({
    salon: salon.name,
    branch: branch.name,
    mainServices: await prisma.mainService.count({ where: { salonId: salon.id } }),
    services: await prisma.service.count({ where: { salonId: salon.id } }),
    staff: await prisma.staff.count({ where: { salonId: salon.id } }),
    customers: await prisma.customer.count({ where: { salonId: salon.id } }),
  });
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
