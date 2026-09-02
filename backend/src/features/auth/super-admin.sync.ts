import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { hashPass } from "../../utils/password.js";

/**
 * Keeps the SUPER_ADMIN user row in sync with SUPER_ADMIN_EMAIL /
 * SUPER_ADMIN_PASSWORD on boot, so changing those env vars and restarting
 * changes the credentials. Login itself stays a normal DB lookup.
 *
 * Targets the row already at SUPER_ADMIN_EMAIL first; failing that, an
 * existing SUPER_ADMIN gets renamed to the new email. That ordering matters
 * because email is unique: renaming blindly collides when another superadmin
 * already holds the address.
 *
 * ponytail: other SUPER_ADMIN rows (e.g. from seed:roles) are left alone.
 * Revoke them explicitly if a single superadmin is meant to be an invariant.
 */
export const syncSuperAdmin = async () => {
  const email = env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.SUPER_ADMIN_PASSWORD;

  if (!email || !password) return;

  const target =
    (await prisma.user.findUnique({ where: { email }, select: { id: true } })) ??
    (await prisma.user.findFirst({
      where: { role: "SUPER_ADMIN" },
      // Oldest wins: with more than one SUPER_ADMIN, an unordered findFirst
      // would rename an arbitrary row when SUPER_ADMIN_EMAIL changes.
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }));

  const credentials = {
    email,
    passwordHash: await hashPass(password),
    role: "SUPER_ADMIN" as const,
    status: "ACTIVE" as const,
  };

  const user = target
    ? await prisma.user.update({
        where: { id: target.id },
        data: { ...credentials, salonId: null, branchId: null },
        select: { id: true, email: true },
      })
    : await prisma.user.create({
        data: { ...credentials, name: env.SUPER_ADMIN_NAME || "Super Admin" },
        select: { id: true, email: true },
      });

  console.log(`SUPER_ADMIN ready`);
};
