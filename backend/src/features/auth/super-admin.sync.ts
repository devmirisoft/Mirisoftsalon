import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { hashPass } from "../../utils/password.js";

const RETRYABLE_PRISMA_CODES = new Set(["P1001", "P1002", "P1017"]);

const isRetryableDatabaseError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;

  const code = "code" in error ? error.code : undefined;
  if (typeof code === "string" && RETRYABLE_PRISMA_CODES.has(code)) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /connection\s*(closed|terminated|reset)|server has closed/i.test(
    message
  );
};

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await syncSuperAdminOnce();
      return;
    } catch (error) {
      if (attempt === maxAttempts || !isRetryableDatabaseError(error)) {
        throw error;
      }

      console.warn(
        `Super admin sync database connection failed; retrying (${attempt}/${maxAttempts})...`
      );
      await wait(500 * attempt);
    }
  }
};

const syncSuperAdminOnce = async () => {
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
