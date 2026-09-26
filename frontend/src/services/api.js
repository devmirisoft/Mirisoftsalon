const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/+$/, "");
const SESSION_KEY = "salon.auth.session";

export class ApiError extends Error {
  constructor(message, status = 0, errors = null, payload = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
    // e.g. code INSUFFICIENT_STOCK with the stock a transfer could cover.
    this.code = payload?.code || null;
    this.stock = payload?.stock || null;
  }
}

const readSession = () => {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
};

// A salon-wide role can open a session on one branch; every request then
// carries it so the API answers with that branch's data only.
const branchHeader = (session) =>
  session?.activeBranch?.id ? { "X-Branch-Id": session.activeBranch.id } : {};

const toQuery = (params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });
  const value = query.toString();
  return value ? `?${value}` : "";
};

export const request = async (path, options = {}, retrying = false) => {
  const session = readSession();
  const { query, body, headers, ...fetchOptions } = options;
  let response;

  try {
    response = await fetch(`${API_URL}${path}${toQuery(query)}`, {
      credentials: "include",
      ...fetchOptions,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(session?.accessToken
          ? { Authorization: `Bearer ${session.accessToken}` }
          : {}),
        ...branchHeader(session),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(`Cannot connect to the backend at ${API_URL}.`);
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : null;

  if (
    response.status === 401 &&
    !retrying &&
    session?.accessToken &&
    !path.startsWith("/api/auth/")
  ) {
    try {
      const refreshResponse = await fetch(`${API_URL}/api/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const refreshPayload = await refreshResponse.json();
      const accessToken = refreshPayload?.data?.accessToken;
      if (refreshResponse.ok && accessToken) {
        localStorage.setItem(
          SESSION_KEY,
          JSON.stringify({ ...session, accessToken })
        );
        return request(path, options, true);
      }
    } catch {
      // The original 401 response below remains the source of truth.
    }
  }

  if (!response.ok || payload?.success === false) {
    throw new ApiError(
      payload?.message || `Request failed with status ${response.status}`,
      response.status,
      payload?.errors || null,
      payload
    );
  }

  return payload;
};

export const apiConfig = { apiUrl: API_URL, sessionKey: SESSION_KEY };

export const requestBlob = async (path) => {
  const session = readSession();
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: {
      ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
      ...branchHeader(session),
    },
  });
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const payload = await response.json();
      message = payload?.message || message;
    } catch {
      // Keep the HTTP status message for non-JSON errors.
    }
    throw new ApiError(message, response.status);
  }
  return response.blob();
};

export const downloadFile = async (path, query) => {
  const session = readSession();
  const response = await fetch(`${API_URL}${path}${toQuery(query)}`, {
    credentials: "include",
    headers: {
      Accept: "*/*",
      ...(session?.accessToken
        ? { Authorization: `Bearer ${session.accessToken}` }
        : {}),
      ...branchHeader(session),
    },
  });
  if (!response.ok) {
    let message = `Export failed with status ${response.status}`;
    try {
      const payload = await response.json();
      message = payload?.message || message;
    } catch {
      // Keep the HTTP status message for non-JSON errors.
    }
    throw new ApiError(message, response.status);
  }
  const disposition = response.headers.get("content-disposition") || "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  return {
    blob: await response.blob(),
    filename: match?.[1] || "report-export",
  };
};
