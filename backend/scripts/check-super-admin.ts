import "dotenv/config";
import { syncSuperAdmin } from "../src/features/auth/super-admin.sync.js";
import { prisma } from "../src/config/prisma.js";
import { comparePass } from "../src/utils/password.js";

const main = async () => {
  await syncSuperAdmin();

  const email = process.env.SUPER_ADMIN_EMAIL!.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD!;

  // Exactly what login() does: findByEmail -> comparePass -> status check.
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("FAIL: no user at SUPER_ADMIN_EMAIL");
  if (user.role !== "SUPER_ADMIN") throw new Error("FAIL: wrong role " + user.role);
  if (user.status !== "ACTIVE") throw new Error("FAIL: not active");
  if (!(await comparePass(password, user.passwordHash)))
    throw new Error("FAIL: env password does not verify");
  // SUPER_ADMIN is branch-unrestricted, so authenticate() must not branch-lock it.
  if (user.branchId) throw new Error("FAIL: superadmin is pinned to a branch");

  // Idempotent: a second boot reuses the same row instead of creating another.
  await syncSuperAdmin();
  const after = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (after?.id !== user.id)
    throw new Error("FAIL: re-sync did not reuse the same row");

  console.log("PASS: env creds log in, role/status correct, re-sync idempotent");
};

main()
  .catch((e) => { console.error(e.message ?? e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
