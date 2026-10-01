import { annotateAuthFailure } from "./auth-failure.js";
import { createApiConfiguration } from "./api-configuration.js";

const DEFAULT_API_TIMEOUT_MS = 45_000;
const configuration = createApiConfiguration(process.env, process.cwd());
const { keyFile: SIDECAR_KEY_FILE, mcpJson: PROJECT_MCP_JSON } = configuration.paths;
const resolveApiKeyWithSource = () => configuration.apiKey();
const resolveApiKey = () => resolveApiKeyWithSource().key;
const sidecarApiUrl = () => configuration.apiUrl();

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
  extraHeaders?: Record<string, string>,
  // Explicitly annotate reviewed POST reads; other non-read methods fail closed.
  semantics?: { readOnly: true }
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
  let text: string;
  try {
    res = await fetch(url, init);
    text = await res.text();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`VPSnet API request timed out after ${timeoutMs}ms: ${method} ${path}`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  let data: unknown;
  let parsed = false;
  try {
    data = text ? JSON.parse(text) : null;
    parsed = true;
  } catch {
    data = { error: text || res.statusText };
  }

  if (res.ok === false) {
    if (parsed === false || (text.trim() === "" && [502, 503, 504].includes(res.status))) {
      // Not an API answer at all: an HTML or plain-text page from the web
      // server in front of the API (an IP allowlist 403, a 502 from an
      // overloaded upstream). Never hand that page to the model as if it were
      // the API speaking; say what happened, with the status, in one line.
      return {
        status: res.status,
        data: describeNonApiResponse(
          res.status,
          res.headers.get("content-type"),
          text,
          new URL(url).host,
          semantics?.readOnly === true || ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())
        ),
      };
    }

    data = withHttpStatus(res.status, data, res.headers.get("retry-after"));
  }

  // The account API signals auth problems with a bare status plus a message.
  // Explain them here, at the single choke point, so every tool reports the
  // real cause instead of an unactionable "Unauthorized".
  return { status: res.status, data: annotateAuthFailure(res.status, data) };
}

/**
 * Structured tool error for a non-2xx answer whose body is not JSON.
 */
export function describeNonApiResponse(
  status: number,
  contentType: string | null,
  body: string,
  host: string,
  readOnly = false
): Record<string, unknown> {
  const isHtml = /html/i.test(contentType || "") || /^\s*</.test(body);
  const excerpt = body
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

  let reason: string;
  const gatewayFailure = status === 502 || status === 503 || status === 504;
  if (status === 403 && isHtml) {
    reason =
      `HTTP 403 from the web server in front of ${host}, not from the VPSnet API: ` +
      "the address this MCP server calls from is not allowed to reach this host " +
      "(IP allowlist). Run the MCP server from an allowed address, or ask for the address to be allowed.";
  } else if (gatewayFailure) {
    reason =
      `HTTP ${status} from the web server in front of ${host}: no conclusive API response was received. ` +
      (readOnly
        ? "This read-only request can be retried after a short pause."
        : "The request outcome is unknown. Do not automatically repeat it. " +
          "Inspect the current resource state or any returned event/status first. " +
          "If the operation supports idempotency, follow its recovery contract using the original key and unchanged payload; do not create a new key.");
  } else if (status === 404) {
    reason =
      `HTTP 404 from ${host}: no such route. The API may be older or newer than this MCP server build.`;
  } else {
    reason = `HTTP ${status} from ${host} with a non-JSON body; the VPSnet API did not produce this answer.`;
  }

  return {
    success: false,
    error: reason,
    http_status: status,
    non_api_response: true,
    ...(gatewayFailure ? {
      outcome_unknown: !readOnly,
      retry_guidance: readOnly ? "retry_read" : "inspect_state_before_retry",
    } : {}),
    ...(excerpt ? { body_excerpt: excerpt } : {}),
  };
}

function withHttpStatus(status: number, data: unknown, retryAfter: string | null): unknown {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { success: false, http_status: status, body: data };
  }

  const record = data as Record<string, unknown>;
  const extra: Record<string, unknown> = {};
  if (record.http_status === undefined) {
    extra.http_status = status;
  }
  const retry = Number.parseInt(retryAfter || "", 10);
  if (Number.isFinite(retry) && retry > 0 && record.retry_after === undefined) {
    extra.retry_after = retry;
  }

  return Object.keys(extra).length === 0 ? data : { ...record, ...extra };
}

export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
