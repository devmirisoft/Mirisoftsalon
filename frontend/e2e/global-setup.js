import { execSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { API, FIXTURE, SERVERS, STATE, WEB, sessionState } from "./helpers.js";

const backend = path.resolve(import.meta.dirname, "../../backend");
const frontend = path.resolve(import.meta.dirname, "..");

// The test database server from backend/.env.test, database salon_e2e. Never
// the development .env, which may point at a shared database.
const databaseUrl = () => {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const env = readFileSync(path.join(backend, ".env.test"), "utf8");
  const url = new URL(/^DATABASE_URL=["']?([^"'\r\n]+)/m.exec(env)[1]);
  url.pathname = "/salon_e2e";
  url.search = "";
  return url.toString();
};

const waitFor = async (url, timeout = 120_000) => {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
};

export default async () => {
  const DATABASE_URL = databaseUrl();
  execSync("npx tsx scripts/seed-e2e-inventory.ts", {
    cwd: backend,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL, E2E_FIXTURE: FIXTURE },
  });
  execSync("npx vite build", {
    cwd: frontend,
    stdio: "inherit",
    env: { ...process.env, VITE_API_URL: API },
  });
  const start = (command, args, cwd, env) =>
    spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: "ignore", detached: true }).pid;
  const pids = [
    start("npx", ["tsx", "src/index.ts"], backend, {
      DATABASE_URL,
      PORT: new URL(API).port,
      NODE_ENV: "development",
      CLIENT_URLS: WEB,
      // The saved browser session carries no refresh cookie, so the token has
      // to outlive the run rather than expire half way through it.
      ACCESS_TOKEN_EXPIRES_IN: "8h",
      SUPER_ADMIN_EMAIL: "",
      SUPER_ADMIN_PASSWORD: "",
    }),
    // A built app: the dev server spends minutes compiling on first load.
    start("npx", ["vite", "preview", "--port", new URL(WEB).port, "--strictPort"], frontend, {
      VITE_API_URL: API,
    }),
  ];
  writeFileSync(SERVERS, JSON.stringify(pids));
  await Promise.all([waitFor(`${API}/api/health`), waitFor(WEB)]);

  // Sign in once per role and keep the browser state: the login endpoint is
  // rate limited, as it is in production.
  const { password, adminEmail, receptionEmail } = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const { secondReceptionEmail } = JSON.parse(readFileSync(FIXTURE, "utf8"));
  for (const [role, email] of [
    ["admin", adminEmail],
    ["reception", receptionEmail],
    ["reception2", secondReceptionEmail],
  ]) {
    const response = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await response.json();
    if (!body?.data?.accessToken) throw new Error(`Could not sign in as ${email}`);
    writeFileSync(STATE(role), JSON.stringify(sessionState(body.data.accessToken, body.data.user, body.data.branch)));
  }
};
