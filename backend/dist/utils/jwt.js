import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
export const generateAccessToken = (payload) => {
    return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
        expiresIn: "15m"
    });
};
export const generateRefreshToken = (payload) => {
    return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
        expiresIn: "7d",
    });
};
export const verifyAccessToken = (token) => {
    return jwt.verify(token, env.JWT_ACCESS_SECRET);
};
export const verifyRefreshToken = (token) => {
    return jwt.verify(token, env.JWT_REFRESH_SECRET);
};
// Keyed on the current password hash, so a reset link stops working the moment
// the password changes — single-use without storing anything.
export const generatePasswordResetToken = (userId, passwordHash) => jwt.sign({ userId }, env.JWT_ACCESS_SECRET + passwordHash, { expiresIn: "30m" });
export const verifyPasswordResetToken = (token, passwordHash) => jwt.verify(token, env.JWT_ACCESS_SECRET + passwordHash);
