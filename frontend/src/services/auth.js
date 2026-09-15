const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/+$/, "");
const SESSION_KEY = "salon.auth.session";

export class ApiError extends Error {
  constructor(message, status = 0, errors = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
  }
}

const readJson = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json") ? response.json() : null;
};

const getErrorMessage = (response, body) => {
  if (body?.message) return body.message;
  if (response.status >= 500) return "The server is unavailable. Please try again shortly.";
  return "The request could not be completed. Please check your details and try again.";
};

const saveSession = (session) => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
};

const clearSession = () => {
  localStorage.removeItem(SESSION_KEY);
};

export const getStoredSession = () => {
  try {
    const storedValue = localStorage.getItem(SESSION_KEY);
    const session = storedValue ? JSON.parse(storedValue) : null;

    if (!session?.accessToken || !session?.user?.id || !session?.user?.role) {
      clearSession();
      return null;
    }

    return session;
  } catch {
    clearSession();
    return null;
  }
};

export const apiRequest = async (path, options = {}) => {
  const session = getStoredSession();
  let response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError("Cannot connect to the server. Check that the backend is running.");
  }

  const body = await readJson(response);

  if (!response.ok || body?.success === false) {
    throw new ApiError(getErrorMessage(response, body), response.status, body?.errors || null);
  }

  return body;
};

const createSessionFromResponse = (body) => {
  const user = body.data?.user;
  const accessToken = body.data?.accessToken;

  if (!user || !accessToken) {
    throw new ApiError("The server returned an incomplete authentication response.");
  }

  return saveSession({ user, accessToken, branch: body.data?.branch || null });
};

export const login = async ({ email, password }) => {
  const body = await apiRequest("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      password,
    }),
  });

  return createSessionFromResponse(body);
};

const verifySession = (accessToken, activeBranchId) =>
  apiRequest("/api/auth/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(activeBranchId ? { "X-Branch-Id": activeBranchId } : {}),
    },
  });

const refreshSession = async (session) => {
  const body = await apiRequest("/api/auth/refresh", {
    method: "POST",
    headers: { Authorization: "" },
  });
  const accessToken = body.data?.accessToken;

  if (!accessToken) {
    throw new ApiError("The server returned an incomplete refresh response.");
  }

  return saveSession({ ...session, accessToken });
};

// The server is the authority on the open branch session: if the stored branch
// is gone or was never allowed, /me answers with activeBranch null and the
// session falls back to all-branches instead of holding a dead branch id.
const applyVerified = (session, verified) =>
  saveSession({
    ...session,
    branch: verified?.branch || null,
    activeBranch: verified?.activeBranch || null,
  });

export const restoreSession = async () => {
  const session = getStoredSession();
  if (!session) return null;
  const activeBranchId = session.activeBranch?.id;

  try {
    const verified = await verifySession(session.accessToken, activeBranchId);
    return applyVerified(session, verified);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      // The stored branch is no longer reachable; drop it and retry unscoped.
      const verified = await verifySession(session.accessToken);
      return applyVerified({ ...session, activeBranch: null }, verified);
    }
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  }

  try {
    const refreshedSession = await refreshSession(session);
    const verified = await verifySession(
      refreshedSession.accessToken,
      activeBranchId
    );
    return applyVerified(refreshedSession, verified);
  } catch {
    clearSession();
    return null;
  }
};

/** Opens (branch given) or closes (null) a branch session on the stored one. */
export const setActiveBranch = (branch) => {
  const session = getStoredSession();
  if (!session) return null;
  return saveSession({ ...session, activeBranch: branch || null });
};

export const logout = async () => {
  try {
    await apiRequest("/api/auth/logout", { method: "POST" });
  } finally {
    clearSession();
  }
};

export const authConfig = {
  apiUrl: API_URL,
  sessionKey: SESSION_KEY,
};
