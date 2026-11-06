import type { Job } from "./types";

export class ApiError extends Error {}

async function request<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (form) init.body = form;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  const res = await fetch("/api" + path, init);
  const isJson = res.headers.get("content-type")?.includes("json");
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const detail = isJson ? data.detail : data;
    throw new ApiError(Array.isArray(detail) ? detail.map((d: { msg: string }) => d.msg).join(", ") : String(detail));
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, files: File[], field = "files") => {
    const form = new FormData();
    files.forEach((f) => form.append(field, f));
    return request<T>("POST", path, undefined, form);
  },
};

export async function pollJob(id: string, onTick: (j: Job) => void): Promise<Job> {
  for (;;) {
    const job = await api.get<Job>("/jobs/" + id);
    onTick(job);
    if (job.status !== "running") return job;
    await new Promise((r) => setTimeout(r, 700));
  }
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
