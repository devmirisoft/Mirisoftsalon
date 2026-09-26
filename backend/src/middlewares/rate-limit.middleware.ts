import { type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";

const handler = (_req: Request, res: Response) =>
  res.status(429).json({
    success: false,
    message: "Too many requests. Please try again later.",
  });

const skipDuringNormalTests = (req: Request) =>
  process.env.NODE_ENV === "test" && req.get("x-test-rate-limit") !== "enforce";

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipDuringNormalTests,
  handler,
});

// Separate from login so resetting a passcode doesn't burn the login attempts
// needed to sign in with the new one.
export const passwordResetRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipDuringNormalTests,
  handler,
});

export const publicSupportRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipDuringNormalTests,
  handler,
});

export const publicBookingRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipDuringNormalTests,
  handler,
});

export const publicBookingCreateRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipDuringNormalTests,
  handler,
});
