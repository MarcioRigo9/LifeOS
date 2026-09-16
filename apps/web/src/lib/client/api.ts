export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

export async function apiFetch<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body?.error ?? res.statusText ?? "erro", res.status, body?.error);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const apiGet = <T = unknown>(url: string) => apiFetch<T>(url);
export const apiPost = <T = unknown>(url: string, data?: unknown) =>
  apiFetch<T>(url, { method: "POST", body: data !== undefined ? JSON.stringify(data) : undefined });
export const apiPatch = <T = unknown>(url: string, data?: unknown) =>
  apiFetch<T>(url, { method: "PATCH", body: data !== undefined ? JSON.stringify(data) : undefined });
