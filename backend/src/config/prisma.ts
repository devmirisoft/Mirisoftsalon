import "dotenv/config";
import { attachDatabasePool } from "@vercel/functions";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not defined");
}

const globalDatabase = globalThis as unknown as {
  pgPool?: Pool;
  prisma?: PrismaClient;
  vercelPoolAttached?: boolean;
};

const pool =
  globalDatabase.pgPool ||
  new Pool({
    connectionString: databaseUrl,
    max: process.env.VERCEL ? 5 : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: process.env.NODE_ENV === "test",
  });

if (!globalDatabase.pgPool) {
  pool.on("error", (error) => {
    console.error("Unexpected idle PostgreSQL client error:", error);
  });
}

if (process.env.VERCEL && !globalDatabase.vercelPoolAttached) {
  attachDatabasePool(pool);
  globalDatabase.vercelPoolAttached = true;
}

const adapter = new PrismaPg(pool);

export const prisma =
  globalDatabase.prisma ||
  new PrismaClient({
    adapter,
    // Job cart create/confirm run ~65 queries in one transaction; against a
    // remote DB (~280ms/query from a dev machine) the 5s default times out.
    transactionOptions: { timeout: 30_000, maxWait: 10_000 },
  });

globalDatabase.pgPool = pool;
globalDatabase.prisma = prisma;
