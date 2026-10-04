/**
 * Plain-words explanation for the typed dedicated-server readiness reasons the
 * order API returns when it refuses an order before taking payment.
 *
 * Producer: backend OrderController::confirmPrepared answers HTTP 503
 * { dedicatedPreparationUnavailable: true, readinessReason: <code> } from
 * BareMetalOrderAdmission::refusal / BareMetalReadiness::report. The codes are
 * identifiers; the words below mirror BareMetalReadiness::WORDS. Unknown codes
 * pass through unchanged (never guessed at). Nothing here changes whether an
 * order is placed.
 */
const READINESS_WORDS: Record<string, string> = {
  dispatch_disabled: "Installing dedicated servers is switched off.",
  readiness_receipt_missing: "The installer has not reported its health yet.",
  readiness_receipt_stale: "The installer's last health report is too old to trust.",
  readiness_receipt_invalid: "The installer's health report is unreadable.",
  provisioner_dispatch_not_ready: "The installer cannot start installations right now.",
  install_verifier_not_ready:
    "There is no independent check that a finished install really works (no separate probe host).",
  customer_network_not_ready: "The customer network (public address) is not available for this server.",
  customer_network_capability_absent:
    "The installer node cannot attach the customer network (public address) to this server.",
  stock_qualification_missing: "No server has been proven to install this configuration yet.",
  stock_not_available: "Every proven server is taken or on hold.",
  order_input_invalid:
    "The order input is not accepted for a dedicated server: an SSH key (ssh-ed25519 or ssh-rsa) is required and root-password login is not supported.",
  readiness_unavailable: "Dedicated readiness could not be determined right now.",
};

export function explainDedicatedReadiness(data: unknown): unknown {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  const reason = record.readinessReason;
  if (typeof reason !== "string" || record.dedicatedPreparationUnavailable !== true) return data;
  const words = Object.prototype.hasOwnProperty.call(READINESS_WORDS, reason)
    ? READINESS_WORDS[reason]
    : null;
  return {
    ...record,
    dedicated_readiness: {
      reason,
      explanation: words,
      no_payment_taken:
        "The order was refused before payment and no server was reserved; do not retry with a new idempotency key until the reason is resolved.",
    },
  };
}
