import { readFileSync } from "node:fs";
import path from "node:path";

export const API = "http://localhost:5055";
export const WEB = "http://localhost:5175";
export const FIXTURE = path.join(import.meta.dirname, ".fixture.json");
export const SERVERS = path.join(import.meta.dirname, ".servers.json");
/** Signed-in browser state per role, written by global-setup. */
export const STATE = (role) => path.join(import.meta.dirname, `.state-${role}.json`);

/** Ids written by backend/scripts/seed-e2e-inventory.ts. */
export const fixture = () => JSON.parse(readFileSync(FIXTURE, "utf8"));

const storedSession = (role) =>
  JSON.parse(
    JSON.parse(readFileSync(STATE(role), "utf8")).origins[0].localStorage[0].value
  );

/** The bearer token of a role, from the session global-setup signed in with. */
export const tokenFor = (role) => storedSession(role).accessToken;

/** The browser state of a signed-in role, so the suite logs in once each. */
export const sessionState = (accessToken, user, branch) => ({
  cookies: [],
  origins: [
    {
      origin: WEB,
      localStorage: [
        {
          name: "salon.auth.session",
          value: JSON.stringify({
            user,
            accessToken,
            branch: branch || null,
            loggedInAt: Date.now(),
          }),
        },
      ],
    },
  ],
});

export const login = async (page, email, password) => {
  await page.goto("/auth-login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button.sign-in");
  await page.waitForURL((url) => !url.pathname.includes("auth-login"));
};

export const api = async (request, token, method, url, data) => {
  const response = await request.fetch(`${API}${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    ...(data ? { data } : {}),
  });
  const body = await response.json();
  if (!response.ok()) {
    throw new Error(`${method} ${url} → ${response.status()}: ${body.message}`);
  }
  return body.data;
};
