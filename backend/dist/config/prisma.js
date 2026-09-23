import "dotenv/config";
import { attachDatabasePool } from "@vercel/functions";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client.js";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    throw new Error("DATABASE_URL is not defined");
}
const globalDatabase = globalThis;
// Jest gives every test file its own module registry, so each suite builds
// its own pool in the same process. A small pool that lets go of idle
// connections quickly keeps a whole run inside the server's connection limit;
// src/tests/setup.ts also closes the pool when a suite ends.
const isTest = process.env.NODE_ENV === "test";
const pool = globalDatabase.pgPool ||
    new Pool({
        connectionString: databaseUrl,
        max: process.env.VERCEL ? 5 : isTest ? 3 : 10,
        // Opening a connection to the remote DB takes ~4s from a dev machine and a
        // cold pool of 10 ~8s, so keep idle connections warm and let a queued
        // request wait instead of failing at 10s.
        idleTimeoutMillis: process.env.VERCEL ? 30_000 : isTest ? 1_000 : 600_000,
        connectionTimeoutMillis: 30_000,
        allowExitOnIdle: isTest,
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
export const prisma = globalDatabase.prisma ||
    new PrismaClient({
        adapter,
        // Job cart confirm still runs dozens of queries in one transaction; against
        // a remote DB (~300ms/query from a dev machine) the 5s default times out.
        transactionOptions: { timeout: 30_000, maxWait: 10_000 },
    });
globalDatabase.pgPool = pool;
globalDatabase.prisma = prisma;
