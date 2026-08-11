import assert from "node:assert/strict";
import test from "node:test";

import {
  safeTempVmPayload,
  tempVmIdempotencyKeySchema,
  tempVmQuoteTokenSchema,
  tempVmSmtpBlockedPorts,
} from "../build/temp-vm-contract.js";

const quoteToken = `vpsnet_quote_${"q".repeat(48)}`;

const options = {
  orderable: false,
  availability: "coming_soon",
  profiles: [{
    id: "standard",
    name: "Temp Standard",
    plan_id: 12,
    plan_name: "Firecracker S",
    multiplier: 1.5,
    default_ttl: 60,
    plan_hourly_ex_vat: 0.08,
    preferred_server_id: 100,
  }],
  allowed_ttls: [30, 60, 120],
  hard_max_ttl: 360,
  min_bill: 30,
  storage_policy: {
    local_disk_deleted_with_server: true,
    automatic_backups_included: false,
    snapshots_available: false,
  },
  public_ip: {
    enabled: true,
    smtp_block_forced: true,
    smtp_blocked_ports: [25, 2525, 465, 587],
    default_on: true,
  },
  convert_to_monthly_allowed: false,
  max_paid_extensions: 0,
  max_concurrent: 2,
  pool_mode: "tagged",
};

const session = {
  id: 41,
  profile: "standard",
  plan_id: 12,
  os_id: 7,
  order_id: 900,
  order_no: "FC900",
  order_state: "creating",
  ip: "192.0.2.40",
  ttl_minutes: 60,
  billable_minutes: 60,
  amount_ex_vat: 0.5,
  amount_gross: 0.61,
  public_ip_enabled: true,
  status: "creating",
  starts_at: null,
  expires_at: null,
  destroyed_at: null,
  destroy_reason: null,
  refunded: false,
  created_at: "2026-08-10 20:00:00",
  preferred_server_id: 100,
  root_password: "DoNotExpose123",
  credentials: { password: "DoNotExpose123" },
};

test("Temp VM paid proof schemas exactly match the backend character contract", () => {
  assert.equal(
    tempVmIdempotencyKeySchema.safeParse(".temp-vm-attempt-0001").success,
    true,
    "the backend permits punctuation as the first character"
  );
  assert.equal(
    tempVmIdempotencyKeySchema.safeParse("short").success,
    false
  );
  assert.equal(tempVmQuoteTokenSchema.safeParse(quoteToken).success, true);
  assert.equal(
    tempVmQuoteTokenSchema.safeParse(`vpsnet quote ${"q".repeat(48)}`).success,
    false
  );
});

test("Temp VM payload projection keeps customer fields and drops placement and secrets", () => {
  const projected = safeTempVmPayload(200, {
    success: true,
    sessions: [session],
    options,
    pool_mode: "tagged",
    credentials: { token: "secret" },
  });

  assert.equal(projected.success, true);
  assert.equal(projected.sessions[0].order_no, "FC900");
  assert.equal(projected.sessions[0].ip, "192.0.2.40");
  assert.equal(projected.sessions[0].refunded, false);
  assert.equal(projected.options.profiles[0].id, "standard");
  assert.equal(projected.options.orderable, false);
  assert.equal(projected.options.availability, "coming_soon");
  assert.deepEqual(projected.options.storage_policy, {
    local_disk_deleted_with_server: true,
    automatic_backups_included: false,
    snapshots_available: false,
  });
  assert.deepEqual(
    projected.options.public_ip.smtp_blocked_ports,
    tempVmSmtpBlockedPorts
  );
  const json = JSON.stringify(projected);
  assert.doesNotMatch(json, /preferred_server_id|pool_mode|root_password|credentials|DoNotExpose/);
});

test("Temp VM payload projection rejects malformed address and refund state", () => {
  const projected = safeTempVmPayload(200, {
    success: true,
    session: {
      ...session,
      ip: "host.internal.example",
      refunded: "false",
    },
  });

  assert.equal(projected.success, true);
  assert.equal(projected.session.ip, null);
  assert.equal(projected.session.refunded, null);
});

test("Temp VM options fail closed when launch or storage policy is malformed", () => {
  const projected = safeTempVmPayload(200, {
    success: true,
    options: {
      ...options,
      orderable: true,
      availability: "unexpected",
      storage_policy: {
        local_disk_deleted_with_server: "yes",
        automatic_backups_included: "no",
      },
    },
  });

  assert.equal(projected.options.orderable, false);
  assert.equal(projected.options.availability, "coming_soon");
  assert.deepEqual(projected.options.storage_policy, {
    local_disk_deleted_with_server: null,
    automatic_backups_included: null,
    snapshots_available: null,
  });
});

test("Temp VM quote projection bounds usage details and keeps confirmation proof", () => {
  const projected = safeTempVmPayload(200, {
    success: true,
    profile: "standard",
    plan_id: 12,
    plan_name: "Firecracker S",
    ttl_minutes: 60,
    billable_minutes: 60,
    min_bill_minutes: 30,
    hard_max_ttl: 360,
    multiplier: 1.5,
    plan_hourly_ex_vat: 0.08,
    amount_ex_vat: 0.5,
    vat_percent: 21,
    amount_gross: 0.61,
    minimum_charge_applied: true,
    minimum_gross_eur: 0.5,
    currency: "EUR",
    public_ip_default: true,
    public_ip_required: true,
    extensions: 0,
    access: {
      allowed: true,
      reason: null,
      balance: 10,
      usageAccess: {
        can_use: true,
        can_use_services: true,
        payment_access_available: true,
        has_saved_card: false,
        card_fallback_allowed: false,
        block_reason: null,
        notice_reason: null,
        items: [{ private_invoice_id: 99 }],
        orders: [{ order_id: 900 }],
      },
    },
    quoteToken,
    quoteExpiresAt: "2026-08-10 20:15:00",
  });

  assert.equal(projected.quoteToken, quoteToken);
  assert.equal(projected.access.usageAccess.can_use, true);
  assert.doesNotMatch(JSON.stringify(projected), /private_invoice_id|items|orders/);
});

test("Temp VM errors expose bounded remediation rather than arbitrary server text", () => {
  const projected = safeTempVmPayload(403, {
    success: false,
    paidOperationsDisabled: true,
    requiredScope: "fc:order",
    message: "internal database host db.internal",
    debug: { sql: "SELECT *" },
  });

  assert.deepEqual(projected, {
    success: false,
    http_status: 403,
    error_codes: ["paidOperationsDisabled"],
    required_scope: "fc:order",
    retry_after_seconds: null,
  });
});
