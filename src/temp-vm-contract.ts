import { isIP } from "node:net";

import { z } from "zod";

export const tempVmIdSchema = z
  .number()
  .int()
  .positive()
  .describe("Temp VM session ID returned by list_temp_vms");

export const tempVmProfileSchema = z
  .enum(["standard", "power"])
  .describe("Temp VM profile returned by get_temp_vm_options");

export const tempVmTtlSchema = z
  .number()
  .int()
  .min(30)
  .max(360)
  .describe("Session duration from get_temp_vm_options.allowed_ttls");

export const tempVmOsIdSchema = z
  .number()
  .int()
  .positive()
  .describe(
    "Optional enabled Firecracker guest OS ID. Omit it to use the current default; Functions runtime images are rejected."
  );

export const tempVmRootPasswordSchema = z
  .string()
  .min(6)
  .max(40)
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])[A-Za-z0-9]+$/)
  .describe(
    "Optional root password with uppercase, lowercase, and numeric characters. Never use together with ssh_public_key."
  );

export const tempVmSshPublicKeySchema = z
  .string()
  .min(1)
  .max(8192)
  .describe(
    "Optional SSH public key. Never use together with root_password. Omit both credential fields for password delivery by account email."
  );

export const tempVmIdempotencyKeySchema = z
  .string()
  .min(16)
  .max(190)
  .regex(/^[A-Za-z0-9._:-]{16,190}$/)
  .describe(
    "Client-global key for one exact Temp VM quote and create attempt. Reuse it only with the unchanged request."
  );

export const tempVmQuoteTokenSchema = z
  .string()
  .min(32)
  .max(190)
  .regex(/^[A-Za-z0-9._:-]{32,190}$/)
  .describe("Short-lived quote token returned by quote_temp_vm");

const tempVmStatusSchema = z.enum([
  "payment_pending",
  "payment_failed",
  "queued",
  "creating",
  "running",
  "create_failed",
  "destroy_pending",
  "destroying",
  "destroyed",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrNull(value: unknown, maxLength = 255): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return text ? text.slice(0, maxLength) : null;
}

function ipv4OrNull(value: unknown): string | null {
  const candidate = stringOrNull(value, 15);
  return candidate !== null && isIP(candidate) === 4 ? candidate : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function nullablePositiveInteger(value: unknown): number | null {
  return value === null ? null : positiveInteger(value);
}

function safeProfile(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  const id = tempVmProfileSchema.safeParse(source.id);
  const planId = positiveInteger(source.plan_id);
  if (!id.success || planId === null) return null;

  return {
    id: id.data,
    name: stringOrNull(source.name, 128),
    plan_id: planId,
    plan_name: stringOrNull(source.plan_name, 128),
    multiplier: finiteNumber(source.multiplier),
    default_ttl: positiveInteger(source.default_ttl),
    plan_hourly_ex_vat: finiteNumber(source.plan_hourly_ex_vat),
  };
}

function safeOptions(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  const profiles = Array.isArray(source.profiles)
    ? source.profiles.map(safeProfile).filter((item) => item !== null)
    : [];
  const allowedTtls = Array.isArray(source.allowed_ttls)
    ? source.allowed_ttls.filter(
      (item): item is number =>
        typeof item === "number" && Number.isInteger(item) && item >= 30 && item <= 360
    )
    : [];
  const publicIp = record(source.public_ip);
  if (profiles.length === 0 || allowedTtls.length === 0) return null;

  return {
    profiles,
    allowed_ttls: allowedTtls,
    hard_max_ttl: positiveInteger(source.hard_max_ttl),
    min_bill: positiveInteger(source.min_bill),
    public_ip: {
      enabled: publicIp.enabled === true,
      smtp_block_forced: publicIp.smtp_block_forced === true,
      default_on: publicIp.default_on === true,
    },
    convert_to_monthly_allowed: source.convert_to_monthly_allowed === true,
    max_paid_extensions:
      typeof source.max_paid_extensions === "number"
      && Number.isInteger(source.max_paid_extensions)
      && source.max_paid_extensions >= 0
        ? source.max_paid_extensions
        : null,
    max_concurrent: positiveInteger(source.max_concurrent),
  };
}

function safeSession(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  const id = positiveInteger(source.id);
  const profile = tempVmProfileSchema.safeParse(source.profile);
  const status = tempVmStatusSchema.safeParse(source.status);
  if (id === null || !profile.success || !status.success) return null;

  const orderState = source.order_state;
  return {
    id,
    profile: profile.data,
    plan_id: positiveInteger(source.plan_id),
    os_id: positiveInteger(source.os_id),
    order_id: nullablePositiveInteger(source.order_id),
    order_no: stringOrNull(source.order_no, 64),
    order_state:
      typeof orderState === "number" || typeof orderState === "string"
        ? orderState
        : null,
    ip: ipv4OrNull(source.ip),
    ttl_minutes: positiveInteger(source.ttl_minutes),
    billable_minutes: positiveInteger(source.billable_minutes),
    amount_ex_vat: finiteNumber(source.amount_ex_vat),
    amount_gross: finiteNumber(source.amount_gross),
    public_ip_enabled: source.public_ip_enabled === true,
    status: status.data,
    starts_at: stringOrNull(source.starts_at, 32),
    expires_at: stringOrNull(source.expires_at, 32),
    destroyed_at: stringOrNull(source.destroyed_at, 32),
    destroy_reason: stringOrNull(source.destroy_reason, 96),
    refunded:
      typeof source.refunded === "boolean" ? source.refunded : null,
    created_at: stringOrNull(source.created_at, 32),
  };
}

function safeUsageAccess(value: unknown): Record<string, unknown> {
  const source = record(value);
  return {
    can_use: source.can_use === true,
    can_use_services: source.can_use_services === true,
    payment_access_available: source.payment_access_available === true,
    has_saved_card: source.has_saved_card === true,
    card_fallback_allowed: source.card_fallback_allowed === true,
    block_reason: stringOrNull(source.block_reason, 64),
    notice_reason: stringOrNull(source.notice_reason, 64),
  };
}

function errorCodes(value: unknown): string[] {
  const source = record(value);
  const explicit = typeof source.error === "string" ? [source.error] : [];
  const booleans = Object.entries(source)
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => key);

  return [...new Set([...explicit, ...booleans])]
    .filter((key) => /^[A-Za-z][A-Za-z0-9._-]{0,95}$/.test(key))
    .slice(0, 20);
}

function safeQuote(source: Record<string, unknown>): Record<string, unknown> | null {
  const profile = tempVmProfileSchema.safeParse(source.profile);
  const quoteToken = tempVmQuoteTokenSchema.safeParse(source.quoteToken);
  if (!profile.success || !quoteToken.success) return null;

  const access = record(source.access);
  return {
    success: true,
    profile: profile.data,
    plan_id: positiveInteger(source.plan_id),
    plan_name: stringOrNull(source.plan_name, 128),
    ttl_minutes: positiveInteger(source.ttl_minutes),
    billable_minutes: positiveInteger(source.billable_minutes),
    min_bill_minutes: positiveInteger(source.min_bill_minutes),
    hard_max_ttl: positiveInteger(source.hard_max_ttl),
    multiplier: finiteNumber(source.multiplier),
    plan_hourly_ex_vat: finiteNumber(source.plan_hourly_ex_vat),
    amount_ex_vat: finiteNumber(source.amount_ex_vat),
    vat_percent: finiteNumber(source.vat_percent),
    amount_gross: finiteNumber(source.amount_gross),
    minimum_charge_applied: source.minimum_charge_applied === true,
    minimum_gross_eur: finiteNumber(source.minimum_gross_eur),
    currency: source.currency === "EUR" ? "EUR" : null,
    public_ip_default: source.public_ip_default === true,
    public_ip_required: source.public_ip_required === true,
    extensions:
      typeof source.extensions === "number" && Number.isInteger(source.extensions)
        ? source.extensions
        : null,
    access: {
      allowed: access.allowed === true,
      reason: stringOrNull(access.reason, 64),
      balance: finiteNumber(access.balance),
      usageAccess: safeUsageAccess(access.usageAccess),
    },
    quoteToken: quoteToken.data,
    quoteExpiresAt: stringOrNull(source.quoteExpiresAt, 32),
  };
}

export function safeTempVmPayload(
  status: number,
  data: unknown
): Record<string, unknown> {
  const source = record(data);
  if (source.success === true) {
    if (source.quoteToken !== undefined) {
      const quote = safeQuote(source);
      if (quote !== null) return quote;
    }

    if (Array.isArray(source.sessions)) {
      const options = safeOptions(source.options);
      if (options !== null) {
        return {
          success: true,
          sessions: source.sessions
            .map(safeSession)
            .filter((item) => item !== null),
          options,
        };
      }
    }

    const session = safeSession(source.session);
    if (session !== null) {
      const payload: Record<string, unknown> = { success: true, session };
      if (typeof source.replayed === "boolean") {
        payload.replayed = source.replayed;
      }
      return payload;
    }

    const options = safeOptions(source.options);
    if (options !== null) return { success: true, options };
  }

  return {
    success: false,
    http_status: status,
    error_codes: errorCodes(source),
    required_scope: stringOrNull(source.requiredScope, 64),
    retry_after_seconds:
      typeof source.retryAfter === "number" && Number.isInteger(source.retryAfter)
        ? source.retryAfter
        : null,
  };
}
