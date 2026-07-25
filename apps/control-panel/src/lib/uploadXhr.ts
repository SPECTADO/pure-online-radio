import { apiUrl } from "./apiClient";

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
export function uploadWithProgress(
  path: string,
  formData: FormData,
  onProgress: (percent: number) => void,
): Promise<unknown> {
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

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
        return;
      }

      const message =
        body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : `Upload failed with status ${xhr.status}`;
      reject(new Error(message));
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));

    xhr.send(formData);
  });
}
