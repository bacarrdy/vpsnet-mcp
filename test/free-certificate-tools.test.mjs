import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { safeCertificatePayload } from "../build/certificate-contract.js";

const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440010";
const IDEMPOTENCY_KEY = "free-certificate-request-0001";
const CSR = `-----BEGIN CERTIFICATE REQUEST-----\n${"QUJD".repeat(32)}\n-----END CERTIFICATE REQUEST-----\n`;

const providerOptions = [
  { id: "letsencrypt", name: "Let's Encrypt", default: true },
  { id: "google", name: "Google Trust Services", default: false },
];

const keyModes = [
  { mode: "managed", available: true, reason: null, default: true },
  { mode: "customer_csr", available: true, reason: null, default: false },
];

const instruction = {
  validation_method: "dns_cname",
  automatic: false,
  record: {
    type: "CNAME",
    name: "_acme-challenge.example.com",
    value: "challenge-1.validation.vpsnet.cloud",
    ttl: 300,
  },
  records: [{
    type: "CNAME",
    name: "_acme-challenge.example.com",
    value: "challenge-1.validation.vpsnet.cloud",
    ttl: 300,
  }],
  verified: false,
  last_check: { at: null, detail: null },
  note_key: "freeCertificates.instruction.cnameOnceForever",
  acme_challenge_token: "must-not-leak",
};

const freeRequest = {
  id: REQUEST_ID,
  hostname: "example.com",
  identifiers: ["example.com", "www.example.com"],
  registered_domain: "example.com",
  state: "issued",
  key_mode: "customer_csr",
  vpsnet_holds_private_key: false,
  validation_method: "dns_cname",
  delivery_method: "assistant_install",
  delivery_order_id: 88106,
  auto_renew: false,
  renewal_requires_new_csr: true,
  issued_at: "2026-08-23 03:00:00",
  not_before: "2026-08-23 02:59:00",
  not_after: "2026-11-21 02:59:00",
  renewal_due_at: "2026-10-22 12:00:00",
  certificate_authority_id: "google",
  certificate_authority: "Google Trust Services",
  download_available: true,
  revocable: true,
  revocation_pending: false,
  attention_required: false,
  created_at: "2026-08-23 02:50:00",
  timeline: [{ event: "issued", actor: "system", created_at: "2026-08-23 03:00:00" }],
  provider_account_id: "must-not-leak",
  provider_order_url: "must-not-leak",
  encrypted_private_key: "must-not-leak",
  last_error: "must-not-leak",
};

const eligibility = {
  success: true,
  eligible: true,
  reason: null,
  qualifies_via: ["owned_domain"],
  quota: {
    pending_requests: 1,
    max_pending_requests: 10,
    registered_domains_used_7d: 1,
    max_registered_domains_7d: 20,
    registered_domains: ["example.com"],
  },
  key_modes: keyModes,
  certificate_authorities: providerOptions,
  eab_hmac_key: "must-not-leak",
};

const preflight = {
  success: true,
  hostname: "example.com",
  identifiers: ["example.com", "www.example.com"],
  registered_domain: "example.com",
  issuable: true,
  reason: null,
  validation_methods: [
    { method: "dns_zone", available: false, reason: "externalDns", automatic: true },
    { method: "dns_cname", available: true, reason: null, automatic: false },
  ],
  delivery_methods: [
    { method: "download", available: true, reason: null },
    { method: "assistant_install", available: true, reason: null },
  ],
  key_modes: keyModes,
  certificate_authorities: providerOptions,
  recommended: {
    validation_method: "dns_cname",
    delivery_method: "assistant_install",
    key_mode: "managed",
    certificate_authority: "letsencrypt",
  },
  provider_credentials: "must-not-leak",
};

async function harness(t) {
  const requests = [];
  const api = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: raw ? JSON.parse(raw) : null,
    });

    let status = 200;
    let response;
    if (req.method === "GET" && req.url === "/account/certificates/free/eligibility") {
      response = eligibility;
    } else if (req.method === "POST" && req.url === "/account/certificates/free/preflight") {
      response = preflight;
    } else if (
      req.method === "GET"
      && ["/account/certificates/free", "/account/certificates/free?state=issued"].includes(req.url)
    ) {
      response = { success: true, records: [freeRequest], internal_total_cost: "must-not-leak" };
    } else if (req.method === "POST" && req.url === "/account/certificates/free") {
      status = 202;
      response = {
        success: true,
        request: freeRequest,
        instruction,
        csr_sha256: "a".repeat(64),
        replayed: false,
        acme_account_url: "must-not-leak",
      };
    } else if (req.method === "GET" && req.url === `/account/certificates/free/${REQUEST_ID}`) {
      response = { success: true, request: freeRequest, provider_response: "must-not-leak" };
    } else if (
      req.method === "GET"
      && req.url === `/account/certificates/free/${REQUEST_ID}/instruction`
    ) {
      response = { success: true, ...instruction };
    } else if (
      req.method === "GET"
      && req.url === `/account/certificates/free/${REQUEST_ID}/certificate`
    ) {
      response = {
        success: true,
        key_mode: "customer_csr",
        artifact: {
          certificate: "-----BEGIN CERTIFICATE-----\nLEAF\n-----END CERTIFICATE-----\n",
          chain: "-----BEGIN CERTIFICATE-----\nCHAIN\n-----END CERTIFICATE-----\n",
          fullchain: "-----BEGIN CERTIFICATE-----\nFULLCHAIN\n-----END CERTIFICATE-----\n",
          not_after: "2026-11-21 02:59:00",
          fingerprint_sha256: "b".repeat(64),
          private_key: "must-not-leak",
        },
        private_key_included: false,
        material_key_id: "must-not-leak",
      };
    } else if (
      req.method === "POST"
      && req.url === `/account/certificates/free/${REQUEST_ID}/actions/renew`
    ) {
      status = 202;
      response = {
        success: true,
        action: "renew",
        queued: true,
        provider_request: "must-not-leak",
      };
    } else {
      status = 404;
      response = { freeCertificateNotFound: true, reason: "must-not-leak" };
    }

    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(response));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());

  const client = new Client({ name: "free-certificate-tools", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    env: {
      ...process.env,
      VPSNET_API_KEY: "contract-test-key",
      VPSNET_API_URL: `http://127.0.0.1:${api.address().port}`,
    },
  });
  await client.connect(transport);
  t.after(async () => client.close());
  return { client, requests };
}

test("free-certificate tools expose complete public-only automation", async (t) => {
  const { client, requests } = await harness(t);
  const { tools } = await client.listTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const names = [
    "get_free_certificate_eligibility",
    "preflight_free_certificate",
    "list_free_certificates",
    "get_free_certificate",
    "get_free_certificate_instruction",
    "create_free_certificate",
    "download_free_certificate",
    "manage_free_certificate",
  ];
  for (const name of names) assert.equal(byName.has(name), true, `${name} is registered`);
  assert.equal(byName.has("export_free_certificate_private_key"), false);
  assert.equal(byName.get("get_free_certificate_eligibility").annotations.readOnlyHint, true);
  assert.equal(byName.get("preflight_free_certificate").annotations.readOnlyHint, true);
  assert.equal(byName.get("create_free_certificate").annotations.idempotentHint, true);
  assert.equal(byName.get("manage_free_certificate").annotations.destructiveHint, true);
  assert.match(byName.get("create_free_certificate").description, /portal-only.*two-factor/i);
  assert.match(byName.get("download_free_certificate").description, /never.*private key/i);

  const input = {
    hostname: "example.com",
    alternative_names: ["www.example.com"],
    target_order_id: 88106,
    certificate_authority: "google",
  };
  const results = [
    await client.callTool({ name: "get_free_certificate_eligibility", arguments: {} }),
    await client.callTool({ name: "preflight_free_certificate", arguments: input }),
    await client.callTool({ name: "list_free_certificates", arguments: { state: "issued" } }),
    await client.callTool({
      name: "get_free_certificate",
      arguments: { free_certificate_request_id: REQUEST_ID },
    }),
    await client.callTool({
      name: "get_free_certificate_instruction",
      arguments: { free_certificate_request_id: REQUEST_ID },
    }),
  ];
  const created = await client.callTool({
    name: "create_free_certificate",
    arguments: {
      ...input,
      key_mode: "customer_csr",
      csr: CSR,
      validation_method: "dns_cname",
      delivery_method: "assistant_install",
      acknowledge_public_certificate_request: true,
      idempotencyKey: IDEMPOTENCY_KEY,
    },
  });
  results.push(created);
  const downloaded = await client.callTool({
    name: "download_free_certificate",
    arguments: { free_certificate_request_id: REQUEST_ID },
  });
  results.push(downloaded);
  const managed = await client.callTool({
    name: "manage_free_certificate",
    arguments: {
      free_certificate_request_id: REQUEST_ID,
      request: { action: "renew", csr: CSR },
      acknowledge_free_certificate_action: true,
    },
  });
  results.push(managed);

  assert.equal(JSON.parse(created.content[0].text).csr_sha256, "a".repeat(64));
  assert.equal(JSON.parse(downloaded.content[0].text).private_key_included, false);
  const modelContext = results.map((result) => result.content[0].text).join("\n");
  assert.doesNotMatch(
    modelContext,
    /must-not-leak|provider_(?:account|order|credentials|response|request)|encrypted_private_key|acme_(?:account|challenge)|material_key_id|last_error/i
  );
  assert.doesNotMatch(modelContext, /-----BEGIN PRIVATE KEY-----/);
  assert.match(modelContext, /Google Trust Services/);

  const createRequest = requests.find(
    (request) => request.method === "POST" && request.url === "/account/certificates/free"
  );
  assert.equal(createRequest.headers["idempotency-key"], IDEMPOTENCY_KEY);
  assert.deepEqual(createRequest.body, {
    ...input,
    key_mode: "customer_csr",
    csr: CSR,
    validation_method: "dns_cname",
    delivery_method: "assistant_install",
  });
  const actionRequest = requests.find((request) => request.url.endsWith("/actions/renew"));
  assert.deepEqual(actionRequest.body, { csr: CSR });
  assert.equal(requests.some((request) => request.url.endsWith("/download")), false);
});

test("free-certificate schemas reject unsafe or contradictory requests before HTTP", async (t) => {
  const { client, requests } = await harness(t);
  const before = requests.length;
  const managedWithCsr = await client.callTool({
    name: "create_free_certificate",
    arguments: {
      hostname: "example.com",
      alternative_names: [],
      key_mode: "managed",
      csr: CSR,
      validation_method: "dns_cname",
      delivery_method: "download",
      acknowledge_public_certificate_request: true,
      idempotencyKey: IDEMPOTENCY_KEY,
    },
  });
  assert.equal(managedWithCsr.isError, true);
  const missingCsr = await client.callTool({
    name: "create_free_certificate",
    arguments: {
      hostname: "example.com",
      alternative_names: [],
      key_mode: "customer_csr",
      validation_method: "dns_cname",
      delivery_method: "download",
      acknowledge_public_certificate_request: true,
      idempotencyKey: IDEMPOTENCY_KEY,
    },
  });
  assert.equal(missingCsr.isError, true);
  const duplicateName = await client.callTool({
    name: "preflight_free_certificate",
    arguments: { hostname: "example.com", alternative_names: ["example.com"] },
  });
  assert.equal(duplicateName.isError, true);
  const privateKey = await client.callTool({
    name: "create_free_certificate",
    arguments: {
      hostname: "example.com",
      alternative_names: [],
      key_mode: "customer_csr",
      csr: `-----BEGIN PRIVATE KEY-----\n${"A".repeat(128)}\n-----END PRIVATE KEY-----\n`,
      validation_method: "dns_cname",
      delivery_method: "download",
      acknowledge_public_certificate_request: true,
      idempotencyKey: IDEMPOTENCY_KEY,
    },
  });
  assert.equal(privateKey.isError, true);
  assert.equal(requests.length, before);
});

test("free-certificate projection fails closed on private-key artifacts", () => {
  const payload = safeCertificatePayload("free-artifact", 200, {
    success: true,
    key_mode: "managed",
    artifact: {
      certificate: "-----BEGIN CERTIFICATE-----\nLEAF\n-----END CERTIFICATE-----\n",
      chain: "",
      fullchain: "-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----\n",
      not_after: "2026-11-21 02:59:00",
      fingerprint_sha256: "b".repeat(64),
    },
    private_key_included: false,
  });
  assert.equal(payload.success, false);
  assert.deepEqual(payload.errors, ["invalidCertificateResponse"]);
});
