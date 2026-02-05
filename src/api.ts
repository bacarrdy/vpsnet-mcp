const API_BASE = process.env.VPSNET_API_URL || "https://api.vpsnet.com";
const API_KEY = process.env.VPSNET_API_KEY || "";

if (!API_KEY) {
  console.error("VPSNET_API_KEY environment variable is required");
  process.exit(1);
}

export async function apiRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    "X-API-KEY": API_KEY,
    Accept: "application/json",
  };

  const init: RequestInit = { method, headers };

  if (body) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
