import { apiUrl, refreshAccessToken } from "./apiClient";

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * `fetch()` (used by the rest of apiClient) has no broadly-supported way to
 * observe request-body upload progress -- only `XMLHttpRequest.upload` does.
 * This is used exclusively for the upload queue below, where real progress
 * (large audio files, sometimes several queued at once) is worth the extra
 * API surface; every other request in the app goes through the simpler
 * fetch-based apiClient.
 */
export async function uploadWithProgress(
  path: string,
  formData: FormData,
  onProgress: (percent: number) => void,
): Promise<unknown> {
  // Same 401 -> /auth/refresh -> retry-once dance as apiClient.request(): a batch of large
  // uploads (3 at a time) can easily outlive the 15-minute access cookie.
  const first = await sendOnce(path, formData, onProgress);
  if (first.status === 401 && (await refreshAccessToken())) {
    return finish(await sendOnce(path, formData, onProgress));
  }
  return finish(first);
}

interface XhrResult {
  status: number;
  body: unknown;
}

function finish({ status, body }: XhrResult): unknown {
  if (status >= 200 && status < 300) return body;
  const message =
    body && typeof body === "object" && "error" in body
      ? String((body as { error: unknown }).error)
      : `Upload failed with status ${status}`;
  throw new Error(message);
}

function sendOnce(path: string, formData: FormData, onProgress: (percent: number) => void): Promise<XhrResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl(path));
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      const isJson = (xhr.getResponseHeader("content-type") ?? "").includes("application/json");
      const body = xhr.responseText ? (isJson ? safeJsonParse(xhr.responseText) : xhr.responseText) : null;
      resolve({ status: xhr.status, body });
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));

    xhr.send(formData);
  });
}
