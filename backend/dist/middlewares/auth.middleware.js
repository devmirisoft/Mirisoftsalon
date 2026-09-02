import {} from "express";
import jwt, {} from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { isBranchLockedRole } from "../utils/branch-scope.js";
export const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized",
            });
        }
        const token = authHeader.split(" ")[1];
        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Token missing",
            });
        }
        const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
        if (typeof decoded.userId !== "string" ||
            typeof decoded.role !== "string") {
            return res.status(401).json({
                success: false,
                message: "Invalid token",
            });
        }
        const currentUser = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: { id: true, role: true, status: true, salonId: true, branchId: true },
        });
        if (!currentUser) {
            return res.status(401).json({
                success: false,
                message: "User no longer exists",
            });
        }
        if (currentUser.status !== "ACTIVE") {
            return res.status(403).json({
                success: false,
                message: "Account is disabled",
            });
        }
        if (isBranchLockedRole(currentUser.role) && !currentUser.branchId) {
            return res.status(403).json({
                success: false,
                message: "Your account is not assigned to a branch. Contact your salon admin.",
            });
        }
        const user = {
            userId: currentUser.id,
            role: currentUser.role,
            ...(currentUser.salonId ? { salonId: currentUser.salonId } : {}),
            ...(currentUser.branchId ? { branchId: currentUser.branchId } : {}),
        };
        req.user = user;
        next();
    }
    catch (error) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token",
        });
    }
};
