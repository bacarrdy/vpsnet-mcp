import { annotateAuthFailure } from "./auth-failure.js";

const API_BASE = process.env.VPSNET_API_URL || "https://api.vpsnet.com";
const API_KEY = process.env.VPSNET_API_KEY || "";
const DEFAULT_API_TIMEOUT_MS = 45_000;

if (!API_KEY) {
  console.error("VPSNET_API_KEY environment variable is required");
  process.exit(1);
}

function resolveApiTimeoutMs(): number {
  const raw = Number.parseInt(process.env.VPSNET_API_TIMEOUT_MS || "", 10);
  if (Number.isFinite(raw) === false || raw <= 0) {
    return DEFAULT_API_TIMEOUT_MS;
  }

  return raw;
}

export async function apiRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): Promise<{ status: number; data: unknown }> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    "X-API-KEY": API_KEY,
    Accept: "application/json",
    ...(extraHeaders || {}),
  };

  const init: RequestInit = { method, headers };

  if (body) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const timeoutMs = resolveApiTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  init.signal = controller.signal;

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`VPSnet API request timed out after ${timeoutMs}ms: ${method} ${path}`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text || res.statusText };
  }

  // The account API signals auth problems with a bare status plus a message.
  // Explain them here, at the single choke point, so every tool reports the
  // real cause instead of an unactionable "Unauthorized".
  return { status: res.status, data: annotateAuthFailure(res.status, data) };
}

export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
