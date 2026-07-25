import { getConfig } from "./config";

/** Thrown for any non-2xx response from the (public, unauthenticated) player API surface. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Resolves an API-relative path (e.g. a DTO field like coverArtUrl) against
 * the configured API base -- for use directly as an <img src>, where
 * apiClient.get()'s JSON handling doesn't apply. */
export function apiUrl(path: string): string {
  return `${getConfig().apiBaseUrl}${path}`;
}

export const apiClient = {
  async get<T>(path: string): Promise<T> {
    const { apiBaseUrl } = getConfig();
    const res = await fetch(`${apiBaseUrl}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      throw new ApiError(res.status, `GET ${path} failed with status ${res.status}`);
    }

    return (await res.json()) as T;
  },
};
