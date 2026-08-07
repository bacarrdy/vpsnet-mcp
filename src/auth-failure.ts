/**
 * Turn the VPSnet account API's authentication and authorisation rejections
 * into an explanation the caller can act on.
 *
 * The API distinguishes these cases only by HTTP status plus a message or a
 * boolean flag in the JSON body — there is no error-code field and no
 * WWW-Authenticate header. Without this translation an MCP client shows a bare
 * "Unauthorized" and the user has to guess which of six unrelated problems
 * they actually have.
 */

export type AuthFailure = {
  /** Stable machine code, also mirrored as a boolean flag on the payload. */
  code: string;
  /** What actually went wrong. */
  reason: string;
  /** What the user has to change. */
  fix: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function message(data: unknown): string {
  const raw = record(data).message;
  return typeof raw === "string" ? raw : "";
}

const MANAGEMENT_KEY_FIX =
  "Create a management API key in the VPSnet panel under Account > API Keys "
  + "(scope 'full', or 'read' if you only need GET reads) and set it as "
  + "VPSNET_API_KEY. A key is 'vpsnet_' followed by 43 characters.";

/**
 * Classify a non-2xx response. Returns null for anything that is not an
 * authentication or authorisation rejection.
 */
export function explainAuthFailure(
  status: number,
  data: unknown
): AuthFailure | null {
  if (status !== 401 && status !== 403 && status !== 429) {
    return null;
  }

  const payload = record(data);
  const text = message(data);

  // An AI-scoped key (api_keys.scope='ai') is restricted to VPSnet AI
  // inference and is refused on every authenticated account route. This is
  // deliberate backend behaviour, not a misconfigured permission.
  if (text.includes("restricted to VPSnet AI inference")) {
    return {
      code: "aiScopedApiKeyCannotManageAccount",
      reason:
        "This API key is an AI-scoped key. AI-scoped keys are issued only for "
        + "VPSnet AI assistant inference and are deliberately walled off from "
        + "the whole authenticated account API, so no service, application, "
        + "DNS, domain, or billing tool in this server can work with it. "
        + "Adding scopes to it will not help — the restriction is on the key "
        + "type itself.",
      fix:
        "This server needs a separate management API key. "
        + MANAGEMENT_KEY_FIX
        + " Keep the AI-scoped key for VPSnet AI assistant inference only.",
    };
  }

  if (text.includes("API key scope is read-only")) {
    return {
      code: "readOnlyApiKeyCannotWrite",
      reason:
        "This API key has the read-only scope, which is limited to GET "
        + "requests. The tool you called performs a write.",
      fix:
        "Use a full-scope API key for write operations, or restrict yourself "
        + "to read-only tools with this key.",
    };
  }

  if (payload.readOnlyApiKeyForbidden === true) {
    return {
      code: "readOnlyApiKeyForbidden",
      reason:
        "This endpoint refuses read-only API keys because the operation "
        + "changes state.",
      fix: "Use a full-scope API key for this operation.",
    };
  }

  if (payload.apiKeyScopeMissing === true) {
    const required = typeof payload.requiredScope === "string"
      ? payload.requiredScope
      : null;
    return {
      code: "apiKeyScopeMissing",
      reason: required
        ? `The API key authenticated successfully but is missing the '${required}' scope.`
        : "The API key authenticated successfully but is missing a scope this endpoint requires.",
      fix: required
        ? `Add the '${required}' scope to the key in Account > API Keys, or use a key that already has it.`
        : "Grant the endpoint's scope to the key in Account > API Keys.",
    };
  }

  if (payload.apiKeyForbidden === true) {
    return {
      code: "apiKeyForbidden",
      reason:
        "This endpoint is closed to API-key authentication entirely. API keys "
        + "never grant admin access.",
      fix:
        "Perform this operation in the VPSnet panel with a signed-in session. "
        + "Do not attempt to reach it with an API key.",
    };
  }

  if (status === 429 || payload.rate_limited === true) {
    return {
      code: "apiKeyRateLimited",
      reason: "The API key exceeded its request rate limit.",
      fix: "Back off and retry after the retry_after interval.",
    };
  }

  if (status === 401) {
    // Manager::check() swallows the specific AuthException, so an unknown,
    // revoked, expired or malformed key and a non-allowlisted source IP are
    // genuinely indistinguishable here. Say so rather than guessing.
    return {
      code: "apiKeyRejected",
      reason:
        "The API key was rejected at authentication. The account API returns "
        + "one identical 401 for every cause, so this is one of: the key does "
        + "not exist, was revoked, has expired, is malformed, or your source "
        + "IP is not on the key's IP allowlist. Note this is NOT the "
        + "AI-scoped-key case, which returns 403 with its own message.",
      fix:
        "Check the key in Account > API Keys: confirm it is active, unexpired, "
        + "copied whole, and that any IP allowlist on it includes the address "
        + "this server calls from. " + MANAGEMENT_KEY_FIX,
    };
  }

  return {
    code: "apiKeyForbiddenUnclassified",
    reason: "The account API refused this request for the authenticated key.",
    fix: "Check the key's scopes and access settings in Account > API Keys.",
  };
}

/**
 * Merge the explanation into the response payload.
 *
 * The machine code is also set as a boolean flag so that the strict per-feature
 * sanitisers, which keep only `key: true` entries as error codes, still carry
 * the signal through instead of dropping it.
 */
export function annotateAuthFailure(status: number, data: unknown): unknown {
  const failure = explainAuthFailure(status, data);
  if (failure === null) {
    return data;
  }

  return {
    ...record(data),
    [failure.code]: true,
    auth_problem: {
      code: failure.code,
      http_status: status,
      reason: failure.reason,
      fix: failure.fix,
    },
  };
}
