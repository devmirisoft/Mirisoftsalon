import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const initialNodeEnv = process.env.NODE_ENV || "development";

if (initialNodeEnv !== "production") {
  dotenv.config({ path: path.resolve(currentDirectory, "../../.env") });
}

const nodeEnv = process.env.NODE_ENV || initialNodeEnv;
const isProduction = nodeEnv === "production";
const clientUrls = (
  process.env.CLIENT_URLS ||
  process.env.CLIENT_URL ||
  "http://localhost:5173"
)
  .split(",")
  .map((url) => url.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const jwtAccessSecret =
  process.env.JWT_ACCESS_SECRET || "development_access_secret";
const jwtRefreshSecret =
  process.env.JWT_REFRESH_SECRET || "development_refresh_secret";

if (isProduction) {
  const missing = [
    !process.env.DATABASE_URL && "DATABASE_URL",
    !process.env.CLIENT_URLS && !process.env.CLIENT_URL && "CLIENT_URLS",
    !process.env.JWT_ACCESS_SECRET && "JWT_ACCESS_SECRET",
    !process.env.JWT_REFRESH_SECRET && "JWT_REFRESH_SECRET",
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(
      `Missing required production environment variables: ${missing.join(", ")}`
    );
  }

  if (jwtAccessSecret === jwtRefreshSecret) {
    throw new Error(
      "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different in production"
    );
  }
}

export const env = {
  NODE_ENV: nodeEnv,
  IS_PRODUCTION: isProduction,
  PORT: process.env.PORT || "5000",
  CLIENT_URLS: clientUrls,
  JWT_ACCESS_SECRET: jwtAccessSecret,
  JWT_REFRESH_SECRET: jwtRefreshSecret,
  ACCESS_TOKEN_EXPIRES_IN: process.env.ACCESS_TOKEN_EXPIRES_IN || "15m",
  REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN || "7d",
  SUPER_ADMIN_NAME: process.env.SUPER_ADMIN_NAME,
  SUPER_ADMIN_EMAIL: process.env.SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_PASSWORD: process.env.SUPER_ADMIN_PASSWORD,
};
