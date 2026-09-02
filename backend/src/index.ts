import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { syncSuperAdmin } from "./features/auth/super-admin.sync.js";

if (!process.env.VERCEL) {
  const server = app.listen(Number(env.PORT), "0.0.0.0", () => {
    console.log(`Server running on port ${env.PORT}`);
    void syncSuperAdmin().catch((error) =>
      console.error("Super admin sync failed:", error)
    );
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received. Closing server gracefully.`);
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

export default app;
