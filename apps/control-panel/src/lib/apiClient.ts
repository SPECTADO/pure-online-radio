import { getConfig } from "./config";

/**
 * Thrown for any non-2xx response. Callers that want to render a graceful
 * "coming soon" state for the not-yet-implemented backend routes should check
 * `error.isNotImplemented` (HTTP 501, the API's contract for "registered but
 * not built yet": `{ error, todo }`).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  get isNotImplemented(): boolean {
    return this.status === 501;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/** Resolves an API-relative path (e.g. a DTO field like song.coverArtUrl)
 * against the configured API base -- for use directly as an <img src>,
 * where fetch()'s automatic credentials/error handling doesn't apply. */
export function apiUrl(path: string): string {
  return `${getConfig().apiBaseUrl}${path}`;
}

// Paths that must never trigger a refresh-and-retry: /auth/login 401s mean
// "bad credentials", not "stale access token", and /auth/refresh is the
// refresh call itself -- retrying it on its own 401 would recurse forever.
const REFRESH_EXEMPT_PATHS = new Set(["/auth/login", "/auth/refresh"]);

// Shared in-flight refresh so concurrent 401s (e.g. several queries firing
// at once after the access token expires) trigger a single /auth/refresh
// call instead of a stampede of them.
let refreshPromise: Promise<boolean> | null = null;

function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(apiUrl("/auth/refresh"), { method: "POST", credentials: "include" })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function request<T>(path: string, init?: RequestInit, isRetry = false): Promise<T> {
  const url = apiUrl(path);

  const isFormData = init?.body instanceof FormData;

  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      // FormData bodies must NOT get an explicit Content-Type -- the browser
      // sets one itself (multipart/form-data with the correct boundary).
      ...(init?.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  // The access token cookie is short-lived (15m default) but the refresh
  // token lasts days -- on a 401, silently mint a new access token and
  // retry once instead of surfacing a spurious "logged out".
  if (res.status === 401 && !isRetry && !REFRESH_EXEMPT_PATHS.has(path)) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return request<T>(path, init, true);
    }
  }

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);

  if (!res.ok) {
    const message =
      (isJson && body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : undefined) ?? `Request to ${path} failed with status ${res.status}`;
    throw new ApiError(res.status, body, message);
  }

  return body as T;
}

function toBody(data: unknown): BodyInit | undefined {
  if (data === undefined) return undefined;
  if (data instanceof FormData) return data;
  return JSON.stringify(data);
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),

  post: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: toBody(data),
    }),

  put: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: "PUT",
      body: toBody(data),
    }),

  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: "PATCH",
      body: toBody(data),
    }),

  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
