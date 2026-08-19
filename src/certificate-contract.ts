import { z } from "zod";

export type CertificatePayloadKind =
  | "catalog-list"
  | "catalog-product"
  | "order-list"
  | "order"
  | "quote"
  | "confirmation"
  | "validation"
  | "artifact"
  | "action-list"
  | "action"
  | "refresh"
  | "acme-subscription-list"
  | "acme-subscription"
  | "acme-subscription-quote"
  | "acme-subscription-confirmation";

export const certificateOrderIdSchema = z
  .string()
  .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
  .describe("Customer-owned certificate order UUID returned by list_certificates");

export const certificateProductIdSchema = z
  .number()
  .int()
  .positive()
  .describe("Published product ID returned by list_certificate_catalog");

export const certificateOfferIdSchema = z
  .number()
  .int()
  .positive()
  .describe("Published EUR offer ID returned by the selected catalog product");

export const certificateOfferGenerationSchema = z
  .number()
  .int()
  .positive()
  .describe("Exact offer generation returned by the catalog; stale generations are rejected");

export const certificateSubscriptionIdSchema = z
  .string()
  .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
  .describe("Customer-owned Automatic SSL subscription UUID returned by list_automatic_ssl_subscriptions");

const dnsIdentifierSchema = z
  .string()
  .min(3)
  .max(253)
  .refine((identifier) => {
    if (identifier !== identifier.toLowerCase() || identifier !== identifier.trim()) {
      return false;
    }
    const hostname = identifier.startsWith("*.") ? identifier.slice(2) : identifier;
    const labels = hostname.split(".");
    return labels.length >= 2 && labels.every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
    );
  }, "Use a canonical lowercase DNS name or a single leading wildcard");

const certificateAcmeDomainsSchema = z
  .array(dnsIdentifierSchema)
  .min(1)
  .max(255)
  .superRefine((domains, context) => {
    const names = new Set<string>();
    for (const [index, domain] of domains.entries()) {
      if (names.has(domain)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: "Automatic SSL DNS names must be unique",
        });
      }
      names.add(domain);
    }
    for (const [index, domain] of domains.entries()) {
      if (domain.startsWith("www.") && names.has(domain.slice(4))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: "Do not add www separately when its base domain is subscribed",
        });
      }
    }
  })
  .describe(
    "Canonical subscribed DNS names. A base name includes its www alias; an apex and wildcard are separate names and may be ordered together."
  );

export const certificateAcmeSubscriptionInputShape = {
  product_id: certificateProductIdSchema,
  offer_id: certificateOfferIdSchema,
  offer_generation: certificateOfferGenerationSchema,
  domains: certificateAcmeDomainsSchema,
};

const validationMethodSchema = z
  .string()
  .min(3)
  .max(190)
  .refine(
    (method) =>
      ["dns-txt", "dns-cname", "http", "https"].includes(method)
      || /^(?:admin|administrator|hostmaster|postmaster|webmaster)@[a-z0-9](?:[a-z0-9.-]{1,251}[a-z0-9])$/.test(method),
    "Use DNS, HTTP/HTTPS, or an allowed administrative mailbox validation method"
  );

export const certificateIdentifierSchema = z
  .object({
    name: dnsIdentifierSchema,
    validation_method: validationMethodSchema,
  })
  .strict()
  .superRefine((identifier, context) => {
    const hostname = identifier.name.startsWith("*.")
      ? identifier.name.slice(2)
      : identifier.name;
    if (
      identifier.name.startsWith("*.")
      && !["dns-txt", "dns-cname"].includes(identifier.validation_method)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validation_method"],
        message: "Wildcard certificates require DNS validation",
      });
    }
    if (identifier.validation_method.includes("@")) {
      const emailDomain = identifier.validation_method.split("@")[1];
      if (emailDomain !== hostname) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["validation_method"],
          message: "Administrative validation email must use the exact certificate hostname",
        });
      }
    }
  });

export const certificateCsrSchema = z
  .string()
  .min(128)
  .max(65536)
  .refine(
    (value) =>
      /^-----BEGIN CERTIFICATE REQUEST-----\n(?:[A-Za-z0-9+/=]+\n)+-----END CERTIFICATE REQUEST-----\n?$/.test(
        value.replace(/\r\n/g, "\n").trimEnd() + "\n"
      ) && !value.includes("PRIVATE KEY"),
    "Provide only a PEM PKCS#10 certificate signing request; never provide a private key"
  )
  .describe(
    "Customer-generated PEM PKCS#10 CSR. The private key must remain with the customer and must never be sent to VPSnet or an AI assistant."
  );

export const certificateOrderInputShape = {
  product_id: certificateProductIdSchema,
  offer_id: certificateOfferIdSchema,
  offer_generation: certificateOfferGenerationSchema,
  common_name: certificateIdentifierSchema.describe("Primary certificate name and its validation method"),
  alternative_names: z
    .array(certificateIdentifierSchema)
    .max(100)
    .default([])
    .describe("Optional unique subject alternative names; pricing is returned by quote_certificate"),
  csr: certificateCsrSchema,
  administrator_contact_id: z
    .number()
    .int()
    .positive()
    .describe("Owned administrator contact ID selected in the VPSnet certificate order form"),
  technical_contact_id: z
    .number()
    .int()
    .positive()
    .describe("Owned technical contact ID selected in the VPSnet certificate order form"),
  organization_contact_id: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe("Owned organization contact ID when required for OV or EV validation"),
  renewal_of: certificateOrderIdSchema
    .nullable()
    .optional()
    .describe("Existing eligible certificate order UUID when quoting a renewal"),
};

export const certificateActionRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("cancel"),
    reason: z.string().min(3).max(500),
  }).strict(),
  z.object({
    action: z.literal("recheck_validation"),
    domains: z.array(dnsIdentifierSchema).min(1).max(100),
  }).strict(),
  z.object({ action: z.literal("resend_validation") }).strict(),
  z.object({
    action: z.literal("change_validation"),
    domain: dnsIdentifierSchema,
    validation_method: validationMethodSchema,
  }).strict(),
  z.object({
    action: z.literal("reissue"),
    csr: certificateCsrSchema,
    common_name: certificateIdentifierSchema,
    alternative_names: z.array(certificateIdentifierSchema).max(99).default([]),
  }).strict(),
]);

export function certificateActionRequestBody(
  request: z.infer<typeof certificateActionRequestSchema>
): { action: string; body: Record<string, unknown> } {
  const { action, ...body } = request;
  return { action, body };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, maximum = 1024): string | null {
  if (typeof value !== "string" || value.length > maximum || value.includes("\0")) {
    return null;
  }
  return value;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function nullableInteger(value: unknown): number | null {
  return value === null ? null : integer(value);
}

function boolean(value: unknown): boolean {
  return value === true;
}

function timestamp(value: unknown): string | null {
  return value === null ? null : text(value, 64);
}

function money(value: unknown): string | null {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$/.test(value)
    ? value
    : null;
}

function safeIdentifier(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  const parsed = certificateIdentifierSchema.safeParse(source);
  return parsed.success ? parsed.data : null;
}

function safeOffer(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  const id = integer(source.id);
  const generation = integer(source.generation);
  const termMonths = integer(source.term_months);
  const nameKind = source.name_kind === "single" || source.name_kind === "wildcard"
    ? source.name_kind
    : null;
  const basePrice = money(source.base_price);
  const singlePrice = source.san_single_price === null ? null : money(source.san_single_price);
  const wildcardPrice = source.san_wildcard_price === null ? null : money(source.san_wildcard_price);
  if (
    id === null
    || generation === null
    || termMonths === null
    || nameKind === null
    || source.currency !== "EUR"
    || basePrice === null
    || (source.san_single_price !== null && singlePrice === null)
    || (source.san_wildcard_price !== null && wildcardPrice === null)
  ) {
    return null;
  }
  return {
    id,
    generation,
    term_months: termMonths,
    name_kind: nameKind,
    currency: "EUR",
    base_price: basePrice,
    san_single_price: singlePrice,
    san_wildcard_price: wildcardPrice,
  };
}

function safeProduct(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  const id = integer(source.id);
  const label = text(source.label, 255);
  const category = source.category === "caas" || source.category === "tls"
    ? source.category
    : null;
  const fulfillment = source.fulfillment === "acme_subscription"
    || source.fulfillment === "portable_certificate"
    ? source.fulfillment
    : null;
  const validationType = ["DV", "OV", "EV"].includes(String(source.validation_type))
    ? String(source.validation_type)
    : null;
  if (
    id === null
    || label === null
    || category === null
    || fulfillment === null
    || validationType === null
    || (category === "caas") !== (fulfillment === "acme_subscription")
  ) return null;
  const capabilities = record(source.capabilities);
  const management = record(capabilities.management);
  const commonName = record(capabilities.common_name);
  const san = record(capabilities.san);
  const offers = Array.isArray(source.offers)
    ? source.offers.map(safeOffer).filter((offer) => offer !== null)
    : [];
  const includedSingle = nonNegativeInteger(san.included_single);
  const includedWildcard = nonNegativeInteger(san.included_wildcard);
  const minimum = nonNegativeInteger(san.min);
  const maximum = nonNegativeInteger(san.max);
  if (
    includedSingle === null
    || includedWildcard === null
    || minimum === null
    || maximum === null
    || maximum < minimum
  ) return null;
  return {
    id,
    label,
    category,
    fulfillment,
    validation_type: validationType,
    brand: source.brand === null ? null : text(source.brand, 128),
    capabilities: {
      management: {
        cancel: boolean(management.cancel),
        reissue: boolean(management.reissue),
        renew: boolean(management.renew),
        revoke: boolean(management.revoke),
        acme_credentials: boolean(management.acme_credentials),
        domains: boolean(management.domains),
        subscription_renewal: boolean(management.subscription_renewal),
      },
      common_name: {
        single: boolean(commonName.single),
        wildcard: boolean(commonName.wildcard),
        ip: boolean(commonName.ip),
      },
      san: {
        included_single: includedSingle,
        included_wildcard: includedWildcard,
        min: minimum,
        max: maximum,
        single: boolean(san.single),
        wildcard: boolean(san.wildcard),
        ip: boolean(san.ip),
      },
    },
    offers,
  };
}

function safeOrderDomain(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  const identifier = text(source.identifier, 253);
  if (identifier === null) return null;
  return {
    identifier,
    name_kind: source.name_kind === "wildcard" ? "wildcard" : "single",
    validation_method: text(source.validation_method, 253),
    approved: boolean(source.approved),
    validated_at: timestamp(source.validated_at),
  };
}

function safeOrder(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  const id = certificateOrderIdSchema.safeParse(source.id);
  const product = record(source.product);
  const productId = integer(product.id);
  const productLabel = text(product.label, 255);
  const validationType = ["DV", "OV", "EV"].includes(String(product.validation_type))
    ? String(product.validation_type)
    : null;
  const termMonths = integer(product.term_months);
  const amount = record(source.amount);
  const commonName = text(source.common_name, 253);
  const net = money(amount.net);
  const billingState = text(source.billing_state, 64);
  const state = text(source.state, 64);
  const artifactState = text(source.artifact_state, 64);
  const createdAt = timestamp(source.created_at);
  const updatedAt = timestamp(source.updated_at);
  if (
    !id.success
    || productId === null
    || productLabel === null
    || validationType === null
    || termMonths === null
    || commonName === null
    || source.deployment_mode !== "customer_csr"
    || !["order", "renew"].includes(String(source.operation))
    || amount.currency !== "EUR"
    || net === null
    || billingState === null
    || state === null
    || artifactState === null
    || createdAt === null
    || updatedAt === null
  ) return null;
  return {
    id: id.data,
    product: {
      id: productId,
      label: productLabel,
      validation_type: validationType,
      term_months: termMonths,
    },
    common_name: commonName,
    domains: Array.isArray(source.domains)
      ? source.domains.map(safeOrderDomain).filter((domain) => domain !== null)
      : [],
    deployment_mode: "customer_csr",
    operation: source.operation,
    renewal_of: source.renewal_of === null ? null : text(source.renewal_of, 36),
    amount: {
      currency: "EUR",
      net,
    },
    billing_state: billingState,
    payment_id: nullableInteger(source.payment_id),
    refund_payment_id: nullableInteger(source.refund_payment_id),
    refunded_at: timestamp(source.refunded_at),
    state,
    attention_required: boolean(source.attention_required),
    subscription_begin_at: timestamp(source.subscription_begin_at),
    subscription_end_at: timestamp(source.subscription_end_at),
    artifact_state: artifactState,
    download_available: boolean(source.download_available),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function safeQuote(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  const product = record(source.product);
  const commonName = safeIdentifier(source.common_name);
  const amount = record(source.amount);
  const productId = integer(product.id);
  const productLabel = text(product.label, 255);
  const validationType = ["DV", "OV", "EV"].includes(String(product.validation_type))
    ? String(product.validation_type)
    : null;
  const termMonths = integer(product.term_months);
  const csrSha256 = typeof source.csr_sha256 === "string" && /^[a-f0-9]{64}$/.test(source.csr_sha256)
    ? source.csr_sha256
    : null;
  const keyType = ["rsa", "ec-prime256v1", "ec-secp384r1", "ec-secp521r1"].includes(String(source.key_type))
    ? String(source.key_type)
    : null;
  const base = money(amount.base);
  const san = money(amount.san);
  const net = money(amount.net);
  const vat = money(amount.vat);
  const vatRate = money(amount.vat_rate);
  const total = money(amount.total);
  if (
    commonName === null
    || productId === null
    || productLabel === null
    || validationType === null
    || termMonths === null
    || csrSha256 === null
    || keyType === null
    || amount.currency !== "EUR"
    || base === null
    || san === null
    || net === null
    || vat === null
    || vatRate === null
    || total === null
  ) return null;
  return {
    operation: source.operation === "renew" ? "renew" : "order",
    renewal: source.renewal === null ? null : {
      certificate_order_id: text(record(source.renewal).certificate_order_id, 36),
      remaining_days: Number.isInteger(record(source.renewal).remaining_days)
        ? record(source.renewal).remaining_days
        : null,
    },
    product: {
      id: productId,
      label: productLabel,
      validation_type: validationType,
      term_months: termMonths,
    },
    common_name: commonName,
    alternative_names: Array.isArray(source.alternative_names)
      ? source.alternative_names.map(safeIdentifier).filter((item) => item !== null)
      : [],
    csr_sha256: csrSha256,
    key_type: keyType,
    amount: {
      currency: "EUR",
      base,
      san,
      net,
      vat,
      vat_rate: vatRate,
      total,
    },
  };
}

function safeValidation(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  const orderId = certificateOrderIdSchema.safeParse(source.order_id);
  if (!orderId.success) return null;
  const domains = Array.isArray(source.domains) ? source.domains.map((item) => {
    const domain = record(item);
    const challenge = domain.challenge === null ? null : record(domain.challenge);
    return {
      identifier: text(domain.identifier, 253),
      validation_method: text(domain.validation_method, 253),
      approved: boolean(domain.approved),
      challenge: challenge === null ? null : {
        file_name: text(challenge.file_name, 1024),
        value: text(challenge.value, 16384),
      },
      validated_at: timestamp(domain.validated_at),
    };
  }) : [];
  return { order_id: orderId.data, state: text(source.state, 64), domains };
}

function safeArtifact(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  const orderId = certificateOrderIdSchema.safeParse(source.order_id);
  if (!orderId.success || source.private_key_included !== false) return null;
  const pem = (candidate: unknown): string | null => {
    const value = text(candidate, 2_097_152);
    return value !== null && value.includes("-----BEGIN CERTIFICATE-----") && !value.includes("PRIVATE KEY")
      ? value
      : null;
  };
  const generation = integer(source.generation);
  const certificatePem = pem(source.certificate_pem);
  const chainPem = pem(source.chain_pem);
  const fullchainPem = pem(source.fullchain_pem);
  const certificateSha256 = typeof source.certificate_sha256 === "string" && /^[a-f0-9]{64}$/.test(source.certificate_sha256)
    ? source.certificate_sha256
    : null;
  if (
    generation === null
    || certificatePem === null
    || chainPem === null
    || fullchainPem === null
    || certificateSha256 === null
  ) return null;
  return {
    order_id: orderId.data,
    generation,
    certificate_pem: certificatePem,
    chain_pem: chainPem,
    fullchain_pem: fullchainPem,
    certificate_sha256: certificateSha256,
    identifiers: Array.isArray(source.identifiers)
      ? source.identifiers.map((identifier) => text(identifier, 253)).filter((identifier) => identifier !== null)
      : [],
    not_before: timestamp(source.not_before),
    not_after: timestamp(source.not_after),
    fetched_at: timestamp(source.fetched_at),
    private_key_included: false,
  };
}

function safeAction(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  const id = certificateOrderIdSchema.safeParse(source.id);
  const action = ["cancel", "recheck_validation", "resend_validation", "change_validation", "reissue"]
    .includes(String(source.action)) ? source.action : null;
  const state = ["queued", "submitting", "succeeded", "failed", "stale", "reconciliation_required"]
    .includes(String(source.state)) ? source.state : null;
  if (!id.success || action === null || state === null) return null;
  return {
    id: id.data,
    action,
    state,
    outcome_ambiguous: boolean(source.outcome_ambiguous),
    attention_required: boolean(source.attention_required),
    submitted_at: timestamp(source.submitted_at),
    completed_at: timestamp(source.completed_at),
    created_at: timestamp(source.created_at),
    updated_at: timestamp(source.updated_at),
  };
}

function safeAcmeSubscriptionDomain(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  const id = integer(source.id);
  const name = dnsIdentifierSchema.safeParse(source.name);
  const nameKind = source.name_kind === "single" || source.name_kind === "wildcard"
    ? source.name_kind
    : null;
  const state = ["requested", "active", "removing", "removed"].includes(String(source.state))
    ? source.state
    : null;
  if (id === null || !name.success || nameKind === null || state === null) return null;
  if ((nameKind === "wildcard") !== name.data.startsWith("*.")) return null;
  return {
    id,
    name: name.data,
    name_kind: nameKind,
    included: boolean(source.included),
    state,
  };
}

function safeAcmeSubscription(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  const id = certificateSubscriptionIdSchema.safeParse(source.id);
  const product = record(source.product);
  const productLabel = text(product.label, 255);
  const termMonths = integer(product.term_months);
  const state = [
    "awaiting_payment",
    "queued",
    "provisioning",
    "active",
    "cancelled",
    "failed",
    "needs_attention",
  ].includes(String(source.state)) ? source.state : null;
  const billingState = [
    "awaiting_payment",
    "captured",
    "paid",
    "billing_review",
    "refund_required",
    "refund_pending",
    "refunded",
    "failed",
  ].includes(String(source.billing_state)) ? source.billing_state : null;
  const autoRenew = record(source.auto_renew);
  const subscription = record(source.subscription);
  const amount = record(source.amount);
  const net = money(amount.net);
  const createdAt = timestamp(source.created_at);
  const updatedAt = timestamp(source.updated_at);
  const providerEnabled = autoRenew.provider_enabled === null
    ? null
    : typeof autoRenew.provider_enabled === "boolean"
      ? autoRenew.provider_enabled
      : undefined;
  if (
    !id.success
    || source.fulfillment !== "acme_subscription"
    || productLabel === null
    || termMonths === null
    || state === null
    || billingState === null
    || providerEnabled === undefined
    || amount.currency !== "EUR"
    || net === null
    || createdAt === null
    || updatedAt === null
  ) return null;
  const domains = Array.isArray(source.domains)
    ? source.domains.map(safeAcmeSubscriptionDomain).filter((domain) => domain !== null)
    : [];
  if (domains.length === 0) return null;
  return {
    id: id.data,
    fulfillment: "acme_subscription",
    product: { label: productLabel, term_months: termMonths },
    domains,
    state,
    billing_state: billingState,
    credentials_available: boolean(source.credentials_available),
    auto_renew: {
      enabled: boolean(autoRenew.enabled),
      provider_enabled: providerEnabled,
    },
    subscription: {
      begins_at: timestamp(subscription.begins_at),
      ends_at: timestamp(subscription.ends_at),
      renews_at: timestamp(subscription.renews_at),
    },
    amount: { currency: "EUR", net },
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function safeAcmeSubscriptionQuote(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  const product = record(source.product);
  const productId = integer(product.id);
  const productLabel = text(product.label, 255);
  const termMonths = integer(product.term_months);
  const amount = record(source.amount);
  const base = money(amount.base);
  const domainsPrice = money(amount.domains);
  const net = money(amount.net);
  const vat = money(amount.vat);
  const vatRate = money(amount.vat_rate);
  const total = money(amount.total);
  if (
    source.fulfillment !== "acme_subscription"
    || productId === null
    || productLabel === null
    || termMonths === null
    || amount.currency !== "EUR"
    || base === null
    || domainsPrice === null
    || net === null
    || vat === null
    || vatRate === null
    || total === null
  ) return null;
  const domains = Array.isArray(source.domains) ? source.domains.map((value) => {
    const domain = record(value);
    const name = dnsIdentifierSchema.safeParse(domain.name);
    const nameKind = domain.name_kind === "single" || domain.name_kind === "wildcard"
      ? domain.name_kind
      : null;
    if (!name.success || nameKind === null || (nameKind === "wildcard") !== name.data.startsWith("*.")) {
      return null;
    }
    return { name: name.data, name_kind: nameKind };
  }).filter((domain) => domain !== null) : [];
  if (domains.length === 0) return null;
  return {
    fulfillment: "acme_subscription",
    product: { id: productId, label: productLabel, term_months: termMonths },
    domains,
    amount: {
      currency: "EUR",
      base,
      domains: domainsPrice,
      net,
      vat,
      vat_rate: vatRate,
      total,
    },
  };
}

function safeError(status: number, value: unknown): Record<string, unknown> {
  const source = record(value);
  const errors = Object.entries(source)
    .filter(([key, enabled]) => enabled === true && /^[A-Za-z][A-Za-z0-9._-]{0,95}$/.test(key))
    .map(([key]) => key)
    .slice(0, 20);
  return { success: false, status, errors };
}

/**
 * Defense-in-depth projection for the MCP boundary. Even if a future backend
 * response accidentally contains wholesale cost, provider IDs, credentials,
 * request bodies, or raw errors, none of those fields can enter model context.
 */
export function safeCertificatePayload(
  kind: CertificatePayloadKind,
  status: number,
  value: unknown
): Record<string, unknown> {
  const source = record(value);
  if (source.success !== true) return safeError(status, source);

  switch (kind) {
    case "catalog-list":
      return {
        success: true,
        records: Array.isArray(source.records)
          ? source.records.map(safeProduct).filter((product) => product !== null)
          : [],
      };
    case "catalog-product": {
      const product = safeProduct(source.product);
      return product === null ? safeError(502, { invalidCertificateResponse: true }) : { success: true, product };
    }
    case "order-list":
      return {
        success: true,
        records: Array.isArray(source.records)
          ? source.records.map(safeOrder).filter((order) => order !== null)
          : [],
      };
    case "order": {
      const order = safeOrder(source.order);
      return order === null ? safeError(502, { invalidCertificateResponse: true }) : { success: true, order };
    }
    case "quote": {
      const quote = safeQuote(source.quote);
      const quoteToken = text(source.quote_token, 190);
      return quote === null || quoteToken === null
        ? safeError(502, { invalidCertificateResponse: true })
        : {
          success: true,
          quote_token: quoteToken,
          quote_expires_at: timestamp(source.quote_expires_at),
          quote,
        };
    }
    case "confirmation": {
      const order = safeOrder(source.order);
      return order === null
        ? safeError(502, { invalidCertificateResponse: true })
        : {
          success: true,
          replayed: boolean(source.replayed),
          redirect: source.redirect === null ? null : text(source.redirect, 2048),
          payment_id: nullableInteger(source.payment_id),
          order,
          refund_policy: text(source.refund_policy, 1000),
        };
    }
    case "validation": {
      const validation = safeValidation(source.validation);
      return validation === null ? safeError(502, { invalidCertificateResponse: true }) : { success: true, validation };
    }
    case "artifact": {
      const artifact = safeArtifact(source.artifact);
      return artifact === null ? safeError(502, { invalidCertificateResponse: true }) : { success: true, artifact };
    }
    case "action-list":
      return {
        success: true,
        records: Array.isArray(source.records)
          ? source.records.map(safeAction).filter((action) => action !== null)
          : [],
      };
    case "action": {
      const action = safeAction(source.action);
      return action === null ? safeError(502, { invalidCertificateResponse: true }) : { success: true, action };
    }
    case "refresh":
      return source.reconciliation_queued === true
        ? { success: true, reconciliation_queued: true }
        : safeError(502, { invalidCertificateResponse: true });
    case "acme-subscription-list":
      return {
        success: true,
        records: Array.isArray(source.records)
          ? source.records.map(safeAcmeSubscription).filter((subscription) => subscription !== null)
          : [],
      };
    case "acme-subscription": {
      const subscription = safeAcmeSubscription(source.subscription);
      return subscription === null
        ? safeError(502, { invalidCertificateResponse: true })
        : { success: true, subscription };
    }
    case "acme-subscription-quote": {
      const quote = safeAcmeSubscriptionQuote(source.quote);
      const quoteToken = text(source.quote_token, 190);
      return quote === null || quoteToken === null
        ? safeError(502, { invalidCertificateResponse: true })
        : {
          success: true,
          quote_token: quoteToken,
          quote_expires_at: timestamp(source.quote_expires_at),
          quote,
        };
    }
    case "acme-subscription-confirmation": {
      const subscription = safeAcmeSubscription(source.subscription);
      return subscription === null
        ? safeError(502, { invalidCertificateResponse: true })
        : {
          success: true,
          replayed: boolean(source.replayed),
          redirect: source.redirect === null ? null : text(source.redirect, 2048),
          payment_id: nullableInteger(source.payment_id),
          subscription,
          refund_policy: text(source.refund_policy, 1000),
        };
    }
  }
}
