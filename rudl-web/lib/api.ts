// rudl-web/lib/api.ts
const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "https://api.dataruapp.com";

export interface ApiResult<T = any> {
  ok: boolean;
  status: number;
  data: T;
}

export async function api<T = any>(
  path: string,
  method: string = "GET",
  body?: any
): Promise<ApiResult<T>> {
  const init: RequestInit = { method, credentials: "include", headers: {} };

  if (body !== undefined) {
    (init.headers as any)["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, init);
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // 不是 JSON 也不要炸掉
  }
  return { ok: res.ok, status: res.status, data };
}

// 讓舊習慣也能用
// export const j = api;
// 同時提供 default 匯出（想要 import api from "@/lib/api" 也行）
export default api;

async function j(path: string, method: "GET" | "POST" = "GET", body?: any) {
  const opt: RequestInit = {
    method,
    credentials: "include",
    headers: body instanceof FormData ? undefined : { "content-type": "application/json" },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  };
  const res = await fetch(BASE + path, opt);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function apiMyFiles(limit = 100) {
  return j(`/me/files?limit=${limit}`);
}

export function apiUploadFile(file: File, platform?: "apk" | "ipa", pkg?: string, ver?: string) {
  const fd = new FormData();
  fd.append("file", file);
  if (platform) fd.append("platform", platform);
  if (pkg) fd.append("package_name", pkg);
  if (ver) fd.append("version", ver);
  return j("/me/files", "POST", fd);
}

export function apiCreateLinks(payload: {
  title?: string;
  cn_direct?: boolean;
  locale?: string;
  apk?: { file_id: string } | null;
  ios?: { file_id: string } | null;
  code?: string;
}) {
  return j("/me/links", "POST", payload);
}