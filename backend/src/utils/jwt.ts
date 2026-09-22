import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

interface JwtTokenPayload {
  userId: string;
  salonId?: string;
  branchId?: string;
  role: string;
}

export const generateAccessToken = (payload: JwtTokenPayload) => {
    return jwt.sign(
        payload,
        env.JWT_ACCESS_SECRET,
       {
        expiresIn: "15m"
       }
    );
};

export const generateRefreshToken = (payload: JwtTokenPayload) => {
  return jwt.sign(
    payload,
    env.JWT_REFRESH_SECRET,
    {
      expiresIn: "7d",
    }
  );
};

export const verifyAccessToken = (token: string) => {
  return jwt.verify(token, env.JWT_ACCESS_SECRET);
};

export const verifyRefreshToken = (token: string) => {
  return jwt.verify(token, env.JWT_REFRESH_SECRET);
};

// Keyed on the current password hash, so a reset link stops working the moment
// the password changes — single-use without storing anything.
export const generatePasswordResetToken = (userId: string, passwordHash: string) =>
  jwt.sign({ userId }, env.JWT_ACCESS_SECRET + passwordHash, { expiresIn: "30m" });

export const verifyPasswordResetToken = (token: string, passwordHash: string) =>
  jwt.verify(token, env.JWT_ACCESS_SECRET + passwordHash);
