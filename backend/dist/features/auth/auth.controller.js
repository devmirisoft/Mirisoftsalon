import {} from "express";
import { loginSchema, registerSchema } from "./auth.schema.js";
import { UserModel } from "../users/user.model.js";
import { comparePass, hashPass } from "../../utils/password.js";
import { generateAccessToken, generateRefreshToken } from "../../utils/jwt.js";
import { verifyRefreshToken } from "../../utils/jwt.js";
import { env } from "../../config/env.js";
import { isValidTimezone } from "../../utils/timezone.js";
import { buildSalonCode } from "../../utils/business-id.js";
import { createRefreshSession, findActiveRefreshSession, hashRefreshToken, } from "./session.service.js";
import { createBestEffortAuditLog, createAuditLog, requestAuditContext, } from "../audit-logs/audit-log.service.js";
import { prisma } from "../../config/prisma.js";
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
const refreshCookieBase = {
    httpOnly: true,
    secure: env.IS_PRODUCTION,
    sameSite: env.IS_PRODUCTION ? "none" : "lax",
    path: "/",
};
const refreshCookieOptions = {
    ...refreshCookieBase,
    maxAge: 7 * 24 * 60 * 60 * 1000,
};
export const register = async (req, res) => {
    try {
        const protectedField = Object.keys(req.body ?? {}).find((key) => PUBLIC_REGISTER_PROTECTED_FIELDS.has(key));
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
            });
        }
        const { salonName, branchName, adminName, email, password, phone, address, city, state, pincode, timezone, } = data.data;
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
            });
        }
        if (existingPhone) {
            return res.status(409).json({
                success: false,
                message: "user with this phone number already exists"
            });
        }
        const hashpassword = await hashPass(password);
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
        const newUser = onboarding.user;
        const tokenPayload = {
            userId: newUser.id,
            role: newUser.role,
            ...(newUser.salonId ? { salonId: newUser.salonId } : {}),
            ...(newUser.branchId ? { branchId: newUser.branchId } : {}),
        };
        const accessToken = generateAccessToken(tokenPayload);
        const refreshToken = generateRefreshToken(tokenPayload);
        await createRefreshSession(newUser.id, refreshToken);
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
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
};
export const login = async (req, res) => {
    try {
        const data = loginSchema.safeParse(req.body);
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
                accessToken,
            },
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: "Internal server Error"
        });
    }
};
export const me = async (req, res) => {
    return res.status(200).json({
        success: true,
        message: "Authenticated user",
        user: req.user,
    });
};
export const refresh = async (req, res) => {
    try {
        const refreshToken = req.cookies.refreshToken;
        if (!refreshToken) {
            return res.status(401).json({
                success: false,
                message: "Refresh token missing",
            });
        }
        const decoded = verifyRefreshToken(refreshToken);
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
    }
    catch (error) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired refresh token",
        });
    }
};
export const logout = async (req, res) => {
    const refreshToken = typeof req.cookies.refreshToken === "string"
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
    res.clearCookie("refreshToken", refreshCookieBase);
    return res.status(200).json({
        success: true,
        message: "Logged Out successfully"
    });
};
