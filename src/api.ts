import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { annotateAuthFailure } from "./auth-failure.js";

const DEFAULT_API_TIMEOUT_MS = 45_000;
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SIDECAR_KEY_FILE = join(PROJECT_ROOT, ".vpsnet-mcp-key");
const PROJECT_MCP_JSON = join(PROJECT_ROOT, ".mcp.json");

function readTextIfExists(path: string): string {
  try {
    if (!existsSync(path)) {
      return "";
    }
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function mcpJsonEnv(): { VPSNET_API_KEY?: string; VPSNET_API_URL?: string } {
  const mcpJson = readTextIfExists(PROJECT_MCP_JSON);
  if (!mcpJson) {
    return {};
  }
  try {
    const parsed = JSON.parse(mcpJson) as {
      mcpServers?: { vpsnet?: { env?: { VPSNET_API_KEY?: string; VPSNET_API_URL?: string } } };
    };
    return parsed.mcpServers?.vpsnet?.env || {};
  } catch {
    return {};
  }
}

function fileApiKey(): string {
  const fromFile = readTextIfExists(SIDECAR_KEY_FILE)
    .split(/\r?\n/)[0]
    .trim();
  return fromFile.startsWith("vpsnet_") ? fromFile : "";
}

function mcpJsonApiKey(): string {
  const fromJson = (mcpJsonEnv().VPSNET_API_KEY || "").trim();
  return fromJson.startsWith("vpsnet_") ? fromJson : "";
}

function sidecarApiUrl(): string {
  return (mcpJsonEnv().VPSNET_API_URL || "").trim();
}

// The environment variable is the explicit, per-launch signal the MCP client
// passes in, so it always wins. The on-disk sidecars are a fallback for a launch
// that forgot to pass it, never an override: a stray file next to the
// checkout must not silently re-point the server at another account or host.
function resolveApiKeyWithSource(): { key: string; source: string } {
  const envKey = (process.env.VPSNET_API_KEY || "").trim();
  if (envKey) {
    return { key: envKey, source: "VPSNET_API_KEY environment variable" };
  }

  const fromFile = fileApiKey();
  if (fromFile) {
    return { key: fromFile, source: SIDECAR_KEY_FILE };
  }

  const fromJson = mcpJsonApiKey();
  if (fromJson) {
    return { key: fromJson, source: PROJECT_MCP_JSON };
  }

  return { key: "", source: "" };
}

function resolveApiKey(): string {
  return resolveApiKeyWithSource().key;
}

// The resolved base is where a full-access `vpsnet_` key gets sent, so it is
// validated rather than concatenated. Without this a malformed or hostile value
// -- from the environment or from a sidecar file next to the checkout -- would
// ship the key to an arbitrary host with no protocol, credential or host check.
const TRUSTED_API_HOST = /(^|\.)vpsnet\.com$/;

// Loopback is exempt from the https and allowlist rules, and only loopback.
// The control exists to stop a full-access key being shipped to an arbitrary
// *remote* host; a base that resolves to this machine cannot exfiltrate it, and
// refusing loopback bought no security while breaking every local harness and
// every developer running the server against a local API.
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host === "[::1]") {
    return true;
  }

  // 127.0.0.0/8, and only in dotted-quad form -- no DNS name is trusted here.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4 === null) {
    return false;
  }

  const octets = v4.slice(1).map((part) => Number.parseInt(part, 10));
  if (octets.some((octet) => Number.isFinite(octet) === false || octet < 0 || octet > 255)) {
    return false;
  }

  return octets[0] === 127;
}

function resolveApiBase(): string {
  const raw =
    (process.env.VPSNET_API_URL || "").trim() || sidecarApiUrl() || "https://api.vpsnet.com";

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid VPSNET_API_URL: ${raw}`);
  }

  const loopback = isLoopbackHost(url.hostname);

  if (url.protocol !== "https:" && (loopback === false || url.protocol !== "http:")) {
    throw new Error("VPSNET_API_URL must use https.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("VPSNET_API_URL must not carry credentials, query or fragment.");
  }
  // `url.origin` drops any path, so a base with one would silently send requests
  // somewhere other than where it says. Refuse it instead of quietly rewriting.
  if (url.pathname !== "" && url.pathname !== "/") {
    throw new Error(`VPSNET_API_URL must not carry a path: ${url.pathname}`);
  }
  if (loopback === false && TRUSTED_API_HOST.test(url.hostname) === false) {
    throw new Error(`Refusing to send the API key to untrusted host ${url.hostname}.`);
  }

  return url.origin;
}

const startupKey = resolveApiKeyWithSource();
if (!startupKey.key) {
  console.error(
    "No VPSnet API key found. Provide one of: the VPSNET_API_KEY environment variable, " +
      `a key file at ${SIDECAR_KEY_FILE}, or mcpServers.vpsnet.env.VPSNET_API_KEY in ${PROJECT_MCP_JSON}.`
  );
  process.exit(1);
}
// Say out loud where the key came from; key provenance must never be silent.
console.error(`VPSnet MCP: API key loaded from ${startupKey.source}.`);
console.error(`VPSnet MCP: API base resolved to ${resolveApiBase()}.`);

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
  const url = `${resolveApiBase()}${path}`;
  const headers: Record<string, string> = {
    "X-API-KEY": resolveApiKey(),
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
