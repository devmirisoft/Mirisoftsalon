import {
  type CookieOptions,
  type Request,
  type Response,
} from "express";
import jwt from "jsonwebtoken";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "./auth.schema.js";
import { UserModel } from "../users/user.model.js";
import { comparePass, hashPass } from "../../utils/password.js";
import { generateAccessToken, generateRefreshToken } from "../../utils/jwt.js";
import {
  generatePasswordResetToken,
  verifyPasswordResetToken,
  verifyRefreshToken,
} from "../../utils/jwt.js";
import { loginUrl, sendMail, sendWelcomeEmail } from "../../utils/mailer.js";
import { env } from "../../config/env.js";
import { isValidTimezone } from "../../utils/timezone.js";
import { buildSalonCode } from "../../utils/business-id.js";
import {
  createRefreshSession,
  findActiveRefreshSession,
  hashRefreshToken,
} from "./session.service.js";
import {
  createBestEffortAuditLog,
  createAuditLog,
  requestAuditContext,
} from "../audit-logs/audit-log.service.js";
import { prisma } from "../../config/prisma.js";
import { isBranchLockedRole } from "../../utils/branch-scope.js";

const PUBLIC_REGISTER_PROTECTED_FIELDS = new Set([
  "role",
  "permissions",
  "salonId",
  "branchId",
  "isSuperAdmin",
  "isActive",
  "status",
  "createdById",
  "salonCode",
  "branchCode",
]);

const refreshCookieBase: CookieOptions = {
  httpOnly: true,
  secure: env.IS_PRODUCTION,
  sameSite: env.IS_PRODUCTION ? "none" : "lax",
  path: "/",
};

const refreshCookieOptions: CookieOptions = {
  ...refreshCookieBase,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export const register = async (req: Request, res: Response) => {
    try {
        const protectedField = Object.keys(req.body ?? {}).find((key) =>
            PUBLIC_REGISTER_PROTECTED_FIELDS.has(key)
        );

        if (protectedField) {
            return res.status(400).json({
                success: false,
                message: `${protectedField} is server-controlled and cannot be provided during public registration`,
            });
        }

        const data = registerSchema.safeParse(req.body);

        if (!data.success) {
            return res.status(400).json({
                success: false,
                message: "Invalid input data",
                errors: data.error.flatten().fieldErrors
            })
        }

        const {
            salonName,
            branchName,
            adminName,
            email,
            password,
            phone,
            address,
            city,
            state,
            pincode,
            timezone,
        } = data.data

        if (timezone && !isValidTimezone(timezone)) {
            return res.status(400).json({
                success: false,
                message: "Invalid salon timezone",
            });
        }

        const existingUser = await UserModel.findByEmail(email);
        const existingPhone = await UserModel.findByPhoneNumber(phone);

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "user with this email already exists"
            })
        }

        if (existingPhone) {
            return res.status(409).json({
                success: false,
                message: "user with this phone number already exists"
            })
        }

        const hashpassword = await hashPass(password)

        const onboarding = await prisma.$transaction(async (tx) => {
            const salon = await tx.salon.create({
                data: {
                    name: salonName,
                    salonCode: buildSalonCode({
                        salonName,
                        timezone: timezone || "Asia/Kolkata",
                    }),
                    timezone: timezone || "Asia/Kolkata",
                    ...(address ? { addressLine1: address } : {}),
                    ...(city ? { city } : {}),
                    ...(state ? { state } : {}),
                    ...(pincode ? { postalCode: pincode } : {}),
                    ...(phone ? { phone } : {}),
                    ...(email ? { email } : {}),
                },
                select: {
                    id: true,
                    name: true,
                    timezone: true,
                },
            });

            const branch = await tx.branch.create({
                data: {
                    name: branchName || "Main Branch",
                    salonId: salon.id,
                    ...(address ? { addressLine1: address } : {}),
                    ...(city ? { city } : {}),
                    ...(state ? { state } : {}),
                    ...(pincode ? { postalCode: pincode } : {}),
                    ...(phone ? { phone } : {}),
                },
                select: {
                    id: true,
                    name: true,
                    salonId: true,
                },
            });

            const user = await tx.user.create({
                data: {
                    name: adminName,
                    email,
                    phone_number: phone,
                    passwordHash: hashpassword,
                    role: "SALON_ADMIN",
                    salonId: salon.id,
                    branchId: branch.id,
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone_number: true,
                    role: true,
                    status: true,
                    salonId: true,
                    branchId: true,
                    createdAt: true,
                },
            });

            await createAuditLog({
                tx,
                salonId: salon.id,
                branchId: branch.id,
                userId: user.id,
                userName: user.name,
                userRole: user.role,
                module: "AUTH",
                action: "CREATE",
                entityId: user.id,
                entityName: salon.name,
                description: "New salon account registered",
                newData: {
                    salonId: salon.id,
                    salonName: salon.name,
                    branchId: branch.id,
                    branchName: branch.name,
                    adminUserId: user.id,
                    adminName: user.name,
                    adminEmail: user.email,
                    role: user.role,
                },
                ...requestAuditContext(req),
            });

            return { salon, branch, user };
        });

        const newUser = onboarding.user

        const tokenPayload = {
            userId: newUser.id,
            role: newUser.role,
            ...(newUser.salonId ? { salonId: newUser.salonId } : {}),
            ...(newUser.branchId ? { branchId: newUser.branchId } : {}),
        };

        const accessToken = generateAccessToken(tokenPayload);
        const refreshToken = generateRefreshToken(tokenPayload);

        await createRefreshSession(newUser.id, refreshToken);
        await sendWelcomeEmail(newUser);

        res.cookie("refreshToken", refreshToken, refreshCookieOptions);

        return res.status(201).json({
            success: true,
            message: "Salon account created successfully",
            data: {
                salon: onboarding.salon,
                branch: onboarding.branch,
                user: {
                    id: newUser.id,
                    name: newUser.name,
                    email: newUser.email,
                    phone: newUser.phone_number,
                    role: newUser.role,
                    salonId: newUser.salonId,
                    branchId: newUser.branchId,
                },
                accessToken,

            },
        })
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        })

    }
}

export const login = async (req: Request, res: Response) => {
    try {
        const data = loginSchema.safeParse(req.body)
        if (!data.success) {
            return res.status(400).json({
                success: false,
                message: "Invalid input data",
                errors: data.error.flatten().fieldErrors,
            });
        }

        const { email, password } = data.data;
        const user = await UserModel.findByEmail(email);

        if (!user) {
            await createBestEffortAuditLog({
                module: "AUTH",
                action: "LOGIN_FAILED",
                entityName: email,
                description: `Failed login attempt for ${email}`,
                newData: { email, reason: "USER_NOT_FOUND" },
                ...requestAuditContext(req),
            });
            return res.status(401).json({
                success: false,
                message: "Invalid email or password",
            });
        }

        const isPasswordValid = await comparePass(password, user.passwordHash);

        if (!isPasswordValid) {
            await createBestEffortAuditLog({
                salonId: user.salonId,
                branchId: user.branchId,
                userId: user.id,
                userName: user.name,
                userRole: user.role,
                module: "AUTH",
                action: "LOGIN_FAILED",
                entityId: user.id,
                entityName: user.name,
                description: `Failed login attempt for ${user.email}`,
                newData: { email: user.email, reason: "INVALID_CREDENTIALS" },
                ...requestAuditContext(req),
            });
            return res.status(401).json({
                success: false,
                message: "Invalid email or password",
            });
        }

        if (user.status !== "ACTIVE") {
            await createBestEffortAuditLog({
                salonId: user.salonId,
                branchId: user.branchId,
                userId: user.id,
                userName: user.name,
                userRole: user.role,
                module: "AUTH",
                action: "LOGIN_FAILED",
                entityId: user.id,
                entityName: user.name,
                description: `Blocked login attempt for disabled account ${user.email}`,
                newData: { email: user.email, reason: "ACCOUNT_DISABLED" },
                ...requestAuditContext(req),
            });
            return res.status(403).json({
                success: false,
                message: "Account is disabled",
            });
        }

        if (isBranchLockedRole(user.role) && !user.branchId) {
            await createBestEffortAuditLog({
                salonId: user.salonId,
                userId: user.id,
                userName: user.name,
                userRole: user.role,
                module: "AUTH",
                action: "LOGIN_FAILED",
                entityId: user.id,
                entityName: user.name,
                description: `Blocked login for ${user.email} with no branch assigned`,
                newData: { email: user.email, reason: "NO_BRANCH_ASSIGNED" },
                ...requestAuditContext(req),
            });
            return res.status(403).json({
                success: false,
                message:
                    "Your account is not assigned to a branch. Contact your salon admin.",
            });
        }

        const tokenPayload = {
            userId: user.id,
            role: user.role,
            ...(user.salonId ? { salonId: user.salonId } : {}),
            ...(user.branchId ? { branchId: user.branchId } : {}),
        };

        const accessToken = generateAccessToken(tokenPayload);
        const refreshToken = generateRefreshToken(tokenPayload);
        await createRefreshSession(user.id, refreshToken);
        const { passwordHash, ...safeUser } = user;

        const branch = user.branchId
            ? await prisma.branch.findUnique({
                  where: { id: user.branchId },
                  select: { id: true, name: true },
              })
            : null;

        res.cookie("refreshToken", refreshToken, refreshCookieOptions);

        await createBestEffortAuditLog({
            salonId: user.salonId,
            branchId: user.branchId,
            userId: user.id,
            userName: user.name,
            userRole: user.role,
            module: "AUTH",
            action: "LOGIN_SUCCESS",
            entityId: user.id,
            entityName: user.name,
            description: `${user.name} logged in`,
            newData: { email: user.email, role: user.role },
            ...requestAuditContext(req),
        });

        return res.status(200).json({
            success: true,
            message: "Login successful",
            data: {
                user: safeUser,
                branch,
                accessToken,
            },
        });
    } catch (error) {
        console.error("Login failed:", error);
        res.status(500).json({
            success: false,
            message: "Internal server Error"
        })
    }
}

export const me = async (req: Request, res: Response) => {
  const findBranch = (id?: string) =>
    id
      ? prisma.branch.findUnique({
          where: { id },
          select: { id: true, name: true },
        })
      : Promise.resolve(null);

  // `branch` is the user's home branch; `activeBranch` is the branch a
  // salon-wide role is currently working in, and is what the app shows on top.
  const [branch, activeBranch] = await Promise.all([
    findBranch(req.user?.branchId),
    findBranch(req.user?.activeBranchId),
  ]);

  return res.status(200).json({
    success: true,
    message: "Authenticated user",
    user: req.user,
    branch,
    activeBranch,
  });
};

export const refresh = async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: "Refresh token missing",
      });
    }

    const decoded = verifyRefreshToken(refreshToken) as {
      userId: string;
      salonId?: string;
      branchId?: string;
      role: string;
    };

    const session = await findActiveRefreshSession(refreshToken);
    if (!session || session.userId !== decoded.userId) {
      return res.status(401).json({
        success: false,
        message: "Refresh session is invalid or revoked",
      });
    }
    if (session.user.status !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message: "Account is disabled",
      });
    }

    const accessToken = generateAccessToken({
      userId: session.user.id,
      role: session.user.role,
      ...(session.user.salonId ? { salonId: session.user.salonId } : {}),
      ...(session.user.branchId ? { branchId: session.user.branchId } : {}),
    });

    return res.status(200).json({
      success: true,
      message: "Access token refreshed",
      data: {
        accessToken,
      },
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired refresh token",
    });
  }
};


// The super admin's password is re-synced from env on startup, so it is
// excluded from email resets.
const canResetPassword = (user: { role: string; status: string }) =>
  user.role !== "SUPER_ADMIN" && user.status === "ACTIVE";

export const forgotPassword = async (req: Request, res: Response) => {
  const data = forgotPasswordSchema.safeParse(req.body);
  if (!data.success) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid email address",
    });
  }

  const user = await UserModel.findByEmail(data.data.email);

  if (user && canResetPassword(user)) {
    const token = generatePasswordResetToken(user.id, user.passwordHash);
    const link = `${env.CLIENT_URLS[0]}/auth-reset?token=${encodeURIComponent(token)}`;
    await sendMail(
      user.email,
      "Reset your MiriSoft passcode",
      `Hi ${user.name},

We received a request to reset your passcode. Open this link to choose a new one:

${link}

The link expires in 30 minutes and works once. If you didn't ask for this, you can ignore this email.`
    );
  }

  // Same answer whether or not the account exists, so this can't be used to
  // find out which emails are registered.
  return res.status(200).json({
    success: true,
    message: "If an account exists for that email, a reset link has been sent.",
  });
};

export const resetPassword = async (req: Request, res: Response) => {
  const data = resetPasswordSchema.safeParse(req.body);
  if (!data.success) {
    return res.status(400).json({
      success: false,
      message: "Invalid input data",
      errors: data.error.flatten().fieldErrors,
    });
  }

  const { token, password } = data.data;
  const invalidLink = () =>
    res.status(400).json({
      success: false,
      message: "This reset link is invalid or has expired. Request a new one.",
    });

  const decoded = jwt.decode(token) as { userId?: unknown } | null;
  const user =
    typeof decoded?.userId === "string"
      ? await UserModel.findById(decoded.userId)
      : null;

  if (!user || !canResetPassword(user)) return invalidLink();

  try {
    verifyPasswordResetToken(token, user.passwordHash);
  } catch {
    return invalidLink();
  }

  const passwordHash = await hashPass(password);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    // Sign out every device that was using the old passcode.
    await tx.userSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await createAuditLog({
      tx,
      salonId: user.salonId,
      branchId: user.branchId,
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      module: "AUTH",
      action: "UPDATE",
      entityId: user.id,
      entityName: user.name,
      description: `${user.name} reset their passcode via email link`,
      ...requestAuditContext(req),
    });
  });

  await sendMail(
    user.email,
    "Your MiriSoft passcode was changed",
    `Hi ${user.name},

Your passcode was just changed and all devices were signed out. Sign in again at ${loginUrl()}

If this wasn't you, contact your salon admin right away.`
  );

  return res.status(200).json({
    success: true,
    message: "Passcode updated. Sign in with your new passcode.",
  });
};

export const logout = async (req: Request, res: Response)=>{
    const refreshToken =
      typeof req.cookies.refreshToken === "string"
        ? req.cookies.refreshToken
        : undefined;
    const session = refreshToken
      ? await findActiveRefreshSession(refreshToken)
      : null;
    await prisma.$transaction(async (tx) => {
      if (refreshToken) {
        await tx.userSession.updateMany({
          where: {
            refreshTokenHash: hashRefreshToken(refreshToken),
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
      }
      await createAuditLog({
        tx,
        salonId: session?.user.salonId,
        branchId: session?.user.branchId,
        userId: session?.user.id,
        userName: session?.user.name,
        userRole: session?.user.role,
        module: "AUTH",
        action: "LOGOUT",
        entityId: session?.user.id,
        entityName: session?.user.name,
        description: session?.user
          ? `${session.user.name} logged out`
          : "Anonymous logout request",
        ...requestAuditContext(req),
      });
    });
    res.clearCookie("refreshToken", refreshCookieBase)

    return res.status(200).json({
        success: true,
        message: "Logged Out successfully"
    })

}
