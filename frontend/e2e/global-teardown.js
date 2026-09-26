import process from "node:process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { SERVERS } from "./helpers.js";

export default async () => {
  if (!existsSync(SERVERS)) return;
  for (const pid of JSON.parse(readFileSync(SERVERS, "utf8"))) {
    try {
      process.kill(-pid, "SIGTERM"); // the whole detached process group
    } catch {
      // already gone
    }
  }
  rmSync(SERVERS, { force: true });
};
