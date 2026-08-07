import { z } from "zod";

export const applicationLogTailLinesSchema = z
  .number()
  .int()
  .min(1)
  .max(500)
  .optional()
  .describe("Maximum log lines to return; defaults to 200 and cannot exceed 500");

export const applicationLogMaxBytesSchema = z
  .number()
  .int()
  .min(1024)
  .max(131072)
  .optional()
  .describe(
    "Maximum log size in bytes; defaults to 65536 and cannot exceed 131072"
  );

export const applicationLogServiceSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,62}$/)
  .optional()
  .describe("Optional exact Compose service whose recent logs should be returned");

export const applicationActionSchema = z
  .enum([
    "reconcile",
    "repair",
    "restart",
    "start",
    "stop",
    "uninstall",
    "update",
  ])
  .describe(
    "Supported lifecycle action. Update applies the backend-selected newer immutable release. Selective data restore is a separate revision-bound operation."
  );

export type ApplicationLifecycleAction = z.infer<
  typeof applicationActionSchema
>;

export const applicationActionIdSchema = z
  .string()
  .uuid()
  .describe(
    "Exact action UUID from the current installation latest_action.id"
  );

export const applicationExpectedVersionSchema = z
  .string()
  .max(96)
  .regex(/^[\x21-\x7E]{1,96}$/)
  .describe(
    "Exact version copied from the current advertised update capability; this is an execution precondition, not a caller-selected target"
  );

const externalHttpsUrlSchema = z.string().max(500).refine((value) => {
  const addressMatch = /^https:\/\/[^/?#]+(\/[^?#]*)?$/i.exec(value);
  if (
    value !== value.trim() ||
    /[^\x21-\x7E]/.test(value) ||
    value.includes("?") ||
    value.includes("#") ||
    !addressMatch
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const labels = hostname.split(".");
    const path = addressMatch[1] || "/";
    return (
      url.protocol === "https:" &&
      hostname.length <= 253 &&
      labels.length >= 2 &&
      labels.every((label) =>
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
      ) &&
      !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) &&
      !hostname.includes(":") &&
      !url.username &&
      !url.password &&
      (url.port === "" || url.port === "443") &&
      path.length <= 500 &&
      (path === "/" || !path.endsWith("/")) &&
      !path.includes("//") &&
      !path.includes("\\") &&
      !/[^A-Za-z0-9._~!$&'()*+,;=:@/-]/.test(path) &&
      !path.split("/").some((segment) => segment === "." || segment === "..")
    );
  } catch {
    return false;
  }
}, "External access must be a credential-free HTTPS URL without a query or fragment");

export const applicationSingleAccessSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("platform_https") }).strict(),
  z.object({ mode: z.literal("private") }).strict(),
  z.object({ mode: z.literal("public_http") }).strict(),
  z.object({ mode: z.literal("external_https"), url: externalHttpsUrlSchema }).strict(),
  z.object({
    mode: z.literal("managed_https"),
    zone_id: z.number().int().positive(),
    subdomain: z
      .string()
      .max(190)
      .regex(
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/
      ),
    approve_dns: z.literal(true),
  }).strict(),
]);

const applicationAccessEndpointSchema = z.object({
  key: z
    .string()
    .max(96)
    .regex(/^[a-z0-9][a-z0-9_-]{0,95}$/),
  access: applicationSingleAccessSchema,
}).strict();

export const applicationAccessSchema = z.union([
  applicationSingleAccessSchema,
  z.object({
    schema_version: z.literal(2),
    endpoints: z
      .array(applicationAccessEndpointSchema)
      .min(1)
      .max(64)
      .superRefine((endpoints, context) => {
        const keys = new Set<string>();
        endpoints.forEach((endpoint, index) => {
          if (keys.has(endpoint.key)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Every endpoint key must occur exactly once",
              path: [index, "key"],
            });
          }
          keys.add(endpoint.key);
        });
      }),
  }).strict(),
]);

export type ApplicationAccess = z.infer<typeof applicationAccessSchema>;
export type ApplicationSingleAccess = z.infer<
  typeof applicationSingleAccessSchema
>;

export const applicationRevisionSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .describe(
    "Current installation revision returned by get_application_installation"
  );

export const applicationResourceCpuPercentSchema = z
  .number()
  .int()
  .min(1)
  .max(6400)
  .nullable()
  .optional()
  .describe("Optional display threshold as a percentage of one CPU core");

export const applicationResourceMemoryMiBSchema = z
  .number()
  .int()
  .min(1)
  .max(1048576)
  .nullable()
  .optional()
  .describe("Optional application memory display threshold in MiB");

export const applicationResourceNetworkMiBPerMinuteSchema = z
  .number()
  .int()
  .min(1)
  .max(1048576)
  .nullable()
  .optional()
  .describe("Optional combined RX and TX display threshold in MiB per minute");

export const applicationResourceRestartDeltaSchema = z
  .number()
  .int()
  .min(1)
  .max(1000)
  .nullable()
  .optional()
  .describe("Optional restart display threshold between comparable samples");

export function applicationResourceThresholdRequestBody(input: {
  cpuPercent?: number | null;
  memoryMiB?: number | null;
  networkMiBPerMinute?: number | null;
  restartDelta?: number | null;
}): Record<string, number | null> {
  return {
    cpuPercent: input.cpuPercent ?? null,
    memoryMiB: input.memoryMiB ?? null,
    networkMiBPerMinute: input.networkMiBPerMinute ?? null,
    restartDelta: input.restartDelta ?? null,
  };
}

export const applicationDataRestorePointIdSchema = z
  .string()
  .uuid()
  .describe(
    "Opaque eligible backup-point UUID returned by list_application_restore_points"
  );

export const applicationDataRestoreIdSchema = z
  .string()
  .uuid()
  .describe(
    "Opaque selective restore UUID returned by restore_application_data"
  );

export const applicationDataRestoreQuoteTokenSchema = z
  .string()
  .min(32)
  .max(190)
  .regex(/^[A-Za-z0-9_.:-]+$/)
  .describe(
    "Exact short-lived quote token returned by quote_application_data_restore"
  );

export function applicationAccessConfigurationRequestBody(
  access: ApplicationAccess,
  expectedRevision: number
): Record<string, unknown> {
  return { access, expectedRevision };
}

/**
 * Generated credentials are always handed to the owner in the VPSnet panel,
 * never returned to this client.
 *
 * The alternative, `inline`, requires a `revealReceipt`: a caller-generated
 * token that asserts "I have received this credential and stored it", after
 * which it is never shown again. An assistant cannot truthfully make that
 * assertion on a user's behalf — its context is transient and is not a place a
 * customer can retrieve a password from later — so acknowledging one-time
 * delivery here would destroy the customer's only copy of the credential.
 * Requesting `portal` keeps the one-time guarantee intact and hands the single
 * reveal to the person who can actually store it.
 */
export const APPLICATION_SECRET_DELIVERY = "portal" as const;

export function applicationInstallRequestBody(params: {
  application: string;
  releaseChannel?: string;
  variables: Record<string, unknown>;
  acknowledgeRuntimeRestart: boolean;
  access?: ApplicationSingleAccess;
}): Record<string, unknown> {
  return {
    application: params.application,
    // Omitted on purpose when the caller did not pick one: the catalog then
    // resolves the application's own published channel. Most published
    // applications do not ship on a channel named "stable", so a hardcoded
    // default here rejected them.
    ...(params.releaseChannel !== undefined
      ? { releaseChannel: params.releaseChannel }
      : {}),
    variables: params.variables,
    secretDelivery: APPLICATION_SECRET_DELIVERY,
    ...(params.acknowledgeRuntimeRestart
      ? { acknowledgeRuntimeRestart: true }
      : {}),
    ...(params.access ? { access: params.access } : {}),
  };
}

export function applicationLifecycleRequestBody(
  action: ApplicationLifecycleAction,
  acknowledgeDataLoss: boolean,
  expectedUpdate?: {
    blueprintVersion: string;
    upstreamVersion: string;
  }
): Record<string, unknown> {
  if (action === "update") {
    if (!expectedUpdate?.blueprintVersion || !expectedUpdate.upstreamVersion) {
      throw new Error("An exact advertised update release is required.");
    }
    return {
      action,
      expected_blueprint_version: expectedUpdate.blueprintVersion,
      expected_upstream_version: expectedUpdate.upstreamVersion,
    };
  }

  return action === "uninstall"
    ? { action, acknowledgeDataLoss: acknowledgeDataLoss === true }
    : { action };
}

export function applicationDataRestoreRequestBody(params: {
  orderNo: string;
  backupPointId: string;
  expectedRevision: number;
  quoteToken: string;
}): Record<string, unknown> {
  return {
    orderNo: params.orderNo,
    backupPointId: params.backupPointId,
    expectedRevision: params.expectedRevision,
    acknowledgeDataReplacement: true,
    acknowledgeRestoreCharge: true,
    quoteToken: params.quoteToken,
  };
}

export function applicationDataRestoreQuoteRequestBody(params: {
  orderNo: string;
  backupPointId: string;
  expectedRevision: number;
}): Record<string, unknown> {
  return {
    orderNo: params.orderNo,
    backupPointId: params.backupPointId,
    expectedRevision: params.expectedRevision,
  };
}

export function applicationActionCancellationRequestBody(): Record<
  string,
  never
> {
  return {};
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedString(value: unknown, maxLength = 512): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ");
  return text ? text.slice(0, maxLength) : null;
}

function boundedInteger(value: unknown, max: number): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= max
    ? number
    : null;
}

function timestamp(value: unknown): string | null {
  const text = boundedString(value, 64);
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

function uuidV4(value: unknown): string | null {
  const id = boundedString(value, 36);
  return id
    && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)
    ? id
    : null;
}

const APPLICATION_DATA_RESTORE_STATES = new Set([
  "awaiting_payment",
  "queued",
  "running",
  "awaiting_reply",
  "needs_attention",
  "succeeded",
  "failed",
  "cancelled",
]);

const APPLICATION_DATA_RESTORE_STAGES = new Set([
  "awaiting_payment",
  "queued",
  "verifying",
  "restoring",
  "retrying",
  "needs_attention",
  "completed",
  "failed",
  "cancelled",
]);

function safeApplicationDataRestore(value: unknown): Record<string, unknown> | null {
  const restore = record(value);
  const id = uuidV4(restore.id);
  const installationId = uuidV4(restore.installationId);
  const backupPointId = uuidV4(restore.backupPointId);
  const state = boundedString(restore.state, 32);
  const progress = record(restore.progress);
  const percent = boundedInteger(progress.percent, 100);
  const stage = boundedString(progress.stage, 32);
  const createdAt = timestamp(restore.createdAt);
  if (
    !id
    || !installationId
    || !backupPointId
    || !state
    || !APPLICATION_DATA_RESTORE_STATES.has(state)
    || percent === null
    || !stage
    || !APPLICATION_DATA_RESTORE_STAGES.has(stage)
    || !createdAt
  ) {
    return null;
  }

  const restoreMode = boundedString(restore.restoreMode, 16);
  const restoredBytes = restore.restoredBytes === null
    ? null
    : boundedInteger(restore.restoredBytes, Number.MAX_SAFE_INTEGER);
  const restoredItems = restore.restoredItems === null
    ? null
    : boundedInteger(restore.restoredItems, 100000);

  return {
    id,
    installation_id: installationId,
    backup_point_id: backupPointId,
    state,
    progress: { percent, stage },
    restore_mode: restoreMode === "direct" || restoreMode === "staged"
      ? restoreMode
      : null,
    restored_bytes: restoredBytes,
    restored_items: restoredItems,
    health_status: boundedString(restore.healthStatus, 64),
    error_code: boundedString(restore.errorCode, 96),
    restore_request_id: boundedInteger(
      restore.restoreRequestId,
      Number.MAX_SAFE_INTEGER
    ),
    price_ex_vat: boundedMoney(restore.priceExVat),
    total_charged: boundedMoney(restore.totalCharged),
    created_at: createdAt,
    completed_at: timestamp(restore.completedAt),
  };
}

function boundedMoney(value: unknown): number | null {
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000
      ? Math.round(amount * 100) / 100
      : null;
}

function boundedBalance(value: unknown): number | null {
  const amount = Number(value);
  return Number.isFinite(amount)
    && amount >= -1_000_000
    && amount <= 1_000_000
    ? Math.round(amount * 100) / 100
    : null;
}

function safeApplicationDataRestoreQuote(
  value: unknown
): Record<string, unknown> | null {
  const quote = record(value);
  const priceExVat = boundedMoney(quote.price_ex_vat);
  const vatRate = Number(quote.vat_rate);
  const totalCharged = boundedMoney(quote.total_charged);
  const balance = boundedBalance(quote.balance);
  if (
    priceExVat === null
    || !Number.isFinite(vatRate)
    || vatRate < 0
    || vatRate > 100
    || totalCharged === null
    || balance === null
    || typeof quote.balance_sufficient !== "boolean"
  ) {
    return null;
  }

  return {
    price_ex_vat: priceExVat,
    vat_rate: Math.round(vatRate * 100) / 100,
    total_charged: totalCharged,
    balance,
    balance_sufficient: quote.balance_sufficient,
  };
}

export function safeApplicationDataRestorePointsPayload(
  status: number,
  data: unknown
): Record<string, unknown> {
  const payload = record(data);
  if (status < 200 || status >= 300 || payload.success !== true) {
    return {
      success: false,
      status,
      error_codes: errorCodes(payload),
    };
  }

  const points = Array.isArray(payload.points)
    ? payload.points.slice(0, 100).flatMap((value) => {
        const point = record(value);
        const id = uuidV4(point.id);
        const capturedAt = timestamp(point.capturedAt);
        const expiresAt = timestamp(point.expiresAt);
        const sizeBytes = boundedInteger(
          point.sizeBytes,
          Number.MAX_SAFE_INTEGER
        );
        return id
          && capturedAt
          && expiresAt
          && sizeBytes !== null
          && point.consistency === "application"
          ? [{
              id,
              captured_at: capturedAt,
              expires_at: expiresAt,
              size_bytes: sizeBytes,
              consistency: "application",
            }]
          : [];
      })
    : [];
  const quote = safeApplicationDataRestoreQuote(payload.quote);
  if (quote === null) {
    return {
      success: false,
      status,
      error_codes: ["applicationDataRestoreQuoteInvalid"],
    };
  }

  return {
    success: true,
    points,
    quote,
    active_restore: payload.activeRestore === null
      ? null
      : safeApplicationDataRestore(payload.activeRestore),
  };
}

export function safeApplicationDataRestoreQuotePayload(
  status: number,
  data: unknown
): Record<string, unknown> {
  const payload = record(data);
  const quote = safeApplicationDataRestoreQuote(payload.quote);
  const quoteToken = boundedString(payload.quoteToken, 190);
  const quoteExpiresAt = timestamp(payload.quoteExpiresAt);
  if (
    status < 200
    || status >= 300
    || payload.success !== true
    || quote === null
    || !quoteToken
    || !/^[A-Za-z0-9_.:-]{32,190}$/.test(quoteToken)
    || !quoteExpiresAt
  ) {
    return {
      success: false,
      status,
      error_codes: errorCodes(payload),
    };
  }

  return {
    success: true,
    quote,
    quote_token: quoteToken,
    quote_expires_at: quoteExpiresAt,
  };
}

export function safeApplicationDataRestorePayload(
  status: number,
  data: unknown
): Record<string, unknown> {
  const payload = record(data);
  const restore = safeApplicationDataRestore(payload.restore);
  if (
    status < 200
    || status >= 300
    || payload.success !== true
    || restore === null
  ) {
    return {
      success: false,
      status,
      error_codes: errorCodes(payload),
    };
  }

  return {
    success: true,
    ...(typeof payload.replayed === "boolean"
      ? { replayed: payload.replayed }
      : {}),
    restore,
  };
}

function composeServiceName(value: unknown): string | null {
  const name = boundedString(value, 63);
  return name && /^[a-z0-9][a-z0-9_-]{0,62}$/.test(name) ? name : null;
}

const PRIVATE_KEY_BLOCK = /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?)-----[\s\S]*?-----END \1-----/gi;
const TRUNCATED_PRIVATE_KEY_PREFIX = /^[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/i;
const TRUNCATED_PRIVATE_KEY_SUFFIX = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*$/i;
const BEARER_TOKEN = /\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi;
const BASIC_TOKEN = /\b(Basic\s+)[A-Za-z0-9+/]+={0,2}/gi;
const JWT_TOKEN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+(@)/gi;
const KNOWN_TOKEN = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16})\b/g;
const MANAGED_INFERENCE_TOKEN = /\bvpsnet_mi_\d{1,10}_[A-Za-z0-9]{8,64}_[A-Za-z0-9_-]{43,128}\b/g;
const SECRET_ASSIGNMENT = /((?:["']?(?:password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|session[_-]?token)["']?)\s*(?:=|:)\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\]]+)/gi;

function redactApplicationLogText(value: unknown): string {
  let text = typeof value === "string" ? value : String(value ?? "");
  text = text.replace(PRIVATE_KEY_BLOCK, "[redacted]");
  text = text.replace(TRUNCATED_PRIVATE_KEY_PREFIX, "[redacted]");
  text = text.replace(TRUNCATED_PRIVATE_KEY_SUFFIX, "[redacted]");
  text = text.replace(BEARER_TOKEN, "$1[redacted]");
  text = text.replace(BASIC_TOKEN, "$1[redacted]");
  text = text.replace(JWT_TOKEN, "[redacted]");
  text = text.replace(URL_CREDENTIALS, "$1[redacted]$2");
  text = text.replace(KNOWN_TOKEN, "[redacted]");
  text = text.replace(MANAGED_INFERENCE_TOKEN, "[redacted]");
  return text.replace(SECRET_ASSIGNMENT, "$1[redacted]");
}

function safePortalPath(value: string): string | null {
  return /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,511}$/.test(value)
    ? value
    : null;
}

function errorCodes(value: unknown): string[] {
  return Object.entries(record(value))
    .filter(([, nested]) => nested === true)
    .map(([key]) => key)
    .filter((key) => /^[A-Za-z][A-Za-z0-9_]{0,100}$/.test(key))
    .slice(0, 20);
}

/**
 * Project the backend's machine-readable remediation block so a failure says
 * what to send instead of only which code was returned. It is a whitelist: only
 * field names, accepted values and translation keys survive, never a credential
 * value, a receipt or a free-form server string.
 */
function safeApplicationErrorDetail(value: unknown): Record<string, unknown> | null {
  const detail = record(value);
  if (Object.keys(detail).length === 0) {
    return null;
  }

  const resolution = Array.isArray(detail.resolution)
    ? detail.resolution.slice(0, 8).map((entry) => {
        const step = record(entry);
        return {
          field: boundedString(step.field, 64),
          value: typeof step.value === "boolean" || typeof step.value === "number"
            ? step.value
            : boundedString(step.value, 64),
          requires: Array.isArray(step.requires)
            ? step.requires
                .slice(0, 8)
                .map((name) => boundedString(name, 64))
                .filter((name): name is string => name !== null)
            : [],
        };
      })
    : [];

  const credentials = Array.isArray(detail.credentials)
    ? detail.credentials
        .slice(0, 32)
        .map((name) => boundedString(name, 96))
        .filter((name): name is string => name !== null)
    : [];

  return {
    code: boundedString(detail.code, 100),
    message_key: boundedString(detail.message_key, 190),
    reason: boundedString(detail.reason, 96),
    credentials,
    resolution,
  };
}

export function safeApplicationMutationPayload(
  status: number,
  data: unknown,
  portalPath: string
): Record<string, unknown> {
  const payload = record(data);
  const codes = errorCodes(payload);
  const reveal = record(payload.secret_reveal);
  const existingHandoff = record(payload.portal_handoff);
  const delivery = record(payload.secret_delivery);
  const detail = safeApplicationErrorDetail(payload.error_detail);
  const revealRequired = Object.keys(reveal).length > 0
    || existingHandoff.required === true
    || delivery.pending_reveal === true
    || detail?.reason === "generated_credentials"
    || codes.some((code) =>
      /(?:secret.*(?:reveal|delivery)|generated.*credential)/i.test(code)
    );
  const accessPath = safePortalPath(portalPath);
  const portalHandoff = revealRequired && accessPath
    ? {
        required: true,
        reason: "generated_credentials",
        access_path: accessPath,
      }
    : null;

  if (status < 200 || status >= 300 || Object.keys(payload).length === 0) {
    return {
      success: false,
      status,
      error_codes: codes,
      error_detail: detail,
      portal_handoff: portalHandoff,
    };
  }

  const installation = record(payload.installation);
  const action = record(payload.action);
  return {
    success: payload.success === true,
    replayed: payload.replayed === true,
    installation: {
      id: boundedString(installation.id),
      state: boundedString(installation.state),
      application: boundedString(installation.application),
      release_channel: boundedString(installation.release_channel),
      upstream_version: boundedString(installation.upstream_version),
    },
    action: {
      id: boundedString(action.id),
      type: boundedString(action.type),
      state: boundedString(action.state),
    },
    secret_delivery: {
      mode: boundedString(delivery.mode, 32),
      pending_reveal: delivery.pending_reveal === true,
    },
    portal_handoff: portalHandoff,
  };
}

export function safeApplicationRegistryCredentialPayload(
  status: number,
  data: unknown
): Record<string, unknown> {
  const payload = record(data);
  if (status < 200 || status >= 300 || payload.success !== true) {
    return {
      success: false,
      status,
      error_codes: errorCodes(payload),
    };
  }

  const credentials = Array.isArray(payload.credentials)
    ? payload.credentials.slice(0, 2).map((value) => {
        const credential = record(value);
        const registry = credential.registry === "docker.io"
          || credential.registry === "ghcr.io"
          ? credential.registry
          : null;
        return {
          id: boundedString(credential.id, 64),
          registry,
          username: boundedString(credential.username, 128),
          created_at: boundedString(credential.created_at, 64),
          updated_at: boundedString(credential.updated_at, 64),
          rotated_at: boundedString(credential.rotated_at, 64),
          token_present: credential.token_present === true,
        };
      })
    : [];

  return {
    success: true,
    credentials,
  };
}

export function applicationUpdateCandidateMatches(
  data: unknown,
  expected: { blueprintVersion: string; upstreamVersion: string }
): boolean {
  const installation = record(record(data).installation);
  const actions = Array.isArray(installation.available_actions)
    ? installation.available_actions
    : [];
  return actions.some((value) => {
    const action = record(value);
    const release = record(action.release);
    return action.type === "update"
      && release.blueprint_version === expected.blueprintVersion
      && release.upstream_version === expected.upstreamVersion;
  });
}

export function applicationActionCancellationIsAdvertised(
  data: unknown,
  actionId: string
): boolean {
  const installation = record(record(data).installation);
  const latestAction = record(installation.latest_action);
  return latestAction.id === actionId && latestAction.cancellable === true;
}

function safeHealthResult(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  if (Object.keys(source).length === 0) return null;
  return {
    protocol_version: boundedInteger(source.protocol_version, 10),
    installation_id: boundedString(source.installation_id, 128),
    status: boundedString(source.status, 32),
    checked_at: timestamp(source.checked_at),
    unexpected_containers: boundedInteger(source.unexpected_containers, 256),
    services: Array.isArray(source.services)
      ? source.services.slice(0, 16).map((value) => {
          const service = record(value);
          return {
            name: boundedString(service.name, 63),
            status: boundedString(service.status, 32),
            health: boundedString(service.health, 32),
            containers: boundedInteger(service.containers, 256),
            running: boundedInteger(service.running, 256),
            healthy: boundedInteger(service.healthy, 256),
            unhealthy: boundedInteger(service.unhealthy, 256),
            starting: boundedInteger(service.starting, 256),
            restarting: boundedInteger(service.restarting, 256),
            exited: boundedInteger(service.exited, 256),
          };
        })
      : [],
  };
}

function safeLogsResult(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  if (Object.keys(source).length === 0) return null;
  const raw = typeof source.content === "string" ? source.content.slice(0, 131072) : "";
  const content = redactApplicationLogText(raw);
  return {
    protocol_version: boundedInteger(source.protocol_version, 10),
    installation_id: boundedString(source.installation_id, 128),
    collected_at: timestamp(source.collected_at),
    tail_lines: boundedInteger(source.tail_lines, 500),
    max_bytes: boundedInteger(source.max_bytes, 131072),
    line_count: boundedInteger(source.line_count, 1_000_000),
    byte_count: boundedInteger(source.byte_count, 131072),
    truncated: source.truncated === true,
    content: content.slice(0, 24000),
    content_truncated_for_model: content.length > 24000,
  };
}

function safeInspectionResult(
  value: unknown,
  expectedKind: "health" | "logs"
): Record<string, unknown> | null {
  const source = record(value);
  if (Object.keys(source).length === 0) return null;

  return expectedKind === "health"
    ? {
        health: safeHealthResult(source.health),
        worker_node: boundedString(source.worker_node, 128),
        worker_release: boundedString(source.worker_release, 128),
      }
    : {
        logs: safeLogsResult(source.logs),
        worker_node: boundedString(source.worker_node, 128),
        worker_release: boundedString(source.worker_release, 128),
      };
}

export function safeApplicationInspectionPayload(
  status: number,
  data: unknown,
  expectedKind: "health" | "logs"
): Record<string, unknown> {
  const payload = record(data);
  const inspection = record(payload.inspection);
  const result = record(inspection.result);
  const parameters = record(inspection.parameters);
  const timestamps = record(inspection.timestamps);

  return {
    success: status >= 200 && status < 300 && payload.success === true,
    status,
    replayed: payload.replayed === true,
    error_codes: errorCodes(payload),
    inspection: {
      id: boundedString(inspection.id, 128),
      installation_id: boundedString(inspection.installation_id, 128),
      kind: inspection.kind === expectedKind ? expectedKind : null,
      state: boundedString(inspection.state, 32),
      parameters: {
        tail_lines: boundedInteger(parameters.tail_lines, 500),
        max_bytes: boundedInteger(parameters.max_bytes, 131072),
        service: composeServiceName(parameters.service),
      },
      result: safeInspectionResult(result, expectedKind),
      error_code: boundedString(inspection.error_code, 128),
      timestamps: {
        requested_at: timestamp(timestamps.requested_at),
        dispatched_at: timestamp(timestamps.dispatched_at),
        completed_at: timestamp(timestamps.completed_at),
        deadline_at: timestamp(timestamps.deadline_at),
        expires_at: timestamp(timestamps.expires_at),
        updated_at: timestamp(timestamps.updated_at),
      },
    },
  };
}
