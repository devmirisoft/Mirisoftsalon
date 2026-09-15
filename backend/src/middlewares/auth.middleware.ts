import { type NextFunction, type Request, type Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import { isBranchLockedRole } from "../utils/branch-scope.js";

interface AccessTokenPayload {
  userId: string;
  salonId?: string;
  branchId?: string;
  activeBranchId?: string;
  role: string;
}

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
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

    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;

    if (
      typeof decoded.userId !== "string" ||
      typeof decoded.role !== "string"
    ) {
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
        message:
          "Your account is not assigned to a branch. Contact your salon admin.",
      });
    }

    const user: AccessTokenPayload = {
      userId: currentUser.id,
      role: currentUser.role,
      ...(currentUser.salonId ? { salonId: currentUser.salonId } : {}),
      ...(currentUser.branchId ? { branchId: currentUser.branchId } : {}),
    };

    // A salon-wide role can open a session on one branch by sending its id.
    // The branch is verified against the caller's salon, so the header can only
    // narrow what the caller already reaches, never widen it.
    const requestedBranchId = req.headers["x-branch-id"];

    if (
      typeof requestedBranchId === "string" &&
      requestedBranchId &&
      !isBranchLockedRole(currentUser.role)
    ) {
      const branch = await prisma.branch.findFirst({
        where: {
          id: requestedBranchId,
          ...(currentUser.salonId ? { salonId: currentUser.salonId } : {}),
        },
        select: { id: true },
      });

      if (!branch) {
        return res.status(403).json({
          success: false,
          message: "You do not have access to this branch",
        });
      }

      user.activeBranchId = branch.id;
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};
