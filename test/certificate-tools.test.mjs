import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { safeCertificatePayload } from "../build/certificate-contract.js";

const ORDER_ID = "550e8400-e29b-41d4-a716-446655440000";
const ACTION_ID = "550e8400-e29b-41d4-a716-446655440001";
const IDEMPOTENCY_KEY = "certificate-order-0001";
const ACTION_KEY = "certificate-action-0001";
const QUOTE_TOKEN = `certificate_quote_${"q".repeat(48)}`;
const CSR = `-----BEGIN CERTIFICATE REQUEST-----\n${"QUJD".repeat(32)}\n-----END CERTIFICATE REQUEST-----\n`;

const identifier = {
  name: "www.example.com",
  validation_method: "dns-txt",
};

const offer = {
  id: 71,
  generation: 4,
  term_months: 12,
  name_kind: "single",
  currency: "EUR",
  base_price: "19.99",
  san_single_price: "3.99",
  san_wildcard_price: null,
  provider_base_cost: "2.00",
};

const product = {
  id: 17,
  label: "Business TLS",
  validation_type: "OV",
  brand: "Example Trust",
  capabilities: {
    management: { cancel: true, reissue: true, renew: true, revoke: false },
    common_name: { single: true, wildcard: false, ip: false },
    san: {
      included_single: 1,
      included_wildcard: 0,
      min: 0,
      max: 10,
      single: true,
      wildcard: false,
      ip: false,
    },
  },
  offers: [offer],
  vendor: "must-not-leak",
  provider_product_id: "private-provider-id",
};

const customerOrder = {
  id: ORDER_ID,
  product: { id: 17, label: "Business TLS", validation_type: "OV", term_months: 12 },
  common_name: "www.example.com",
  domains: [{
    identifier: "www.example.com",
    name_kind: "single",
    validation_method: "dns-txt",
    approved: false,
    validated_at: null,
  }],
  deployment_mode: "customer_csr",
  operation: "order",
  renewal_of: null,
  amount: { currency: "EUR", net: "19.99" },
  billing_state: "paid",
  payment_id: 99,
  refund_payment_id: null,
  refunded_at: null,
  state: "validating",
  attention_required: false,
  subscription_begin_at: null,
  subscription_end_at: null,
  artifact_state: "not_ready",
  download_available: false,
  created_at: "2026-08-19 10:00:00",
  updated_at: "2026-08-19 10:00:00",
  provider_order_id: 123456,
  request_ciphertext: "must-not-leak",
  last_error_code: "must-not-leak",
};

const action = {
  id: ACTION_ID,
  action: "resend_validation",
  state: "queued",
  outcome_ambiguous: false,
  attention_required: false,
  submitted_at: null,
  completed_at: null,
  created_at: "2026-08-19 10:01:00",
  updated_at: "2026-08-19 10:01:00",
  provider_response: { credential: "must-not-leak" },
};

function quoteResponse() {
  return {
    success: true,
    quote_token: QUOTE_TOKEN,
    quote_expires_at: "2026-08-19 10:15:00",
    quote: {
      operation: "order",
      renewal: null,
      product: { id: 17, label: "Business TLS", validation_type: "OV", term_months: 12 },
      common_name: identifier,
      alternative_names: [],
      csr_sha256: "a".repeat(64),
      key_type: "rsa",
      amount: {
        currency: "EUR",
        base: "19.99",
        san: "0.00",
        net: "19.99",
        vat: "4.20",
        vat_rate: "21.00",
        total: "24.19",
      },
    },
    provider_cost: "2.00",
  };
}

async function harness(t) {
  const requests = [];
  const api = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const request = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: raw ? JSON.parse(raw) : null,
    };
    requests.push(request);

    let status = 200;
    let response;
    if (req.method === "GET" && req.url === "/account/certificates/catalog") {
      response = { success: true, records: [product], provider: "must-not-leak" };
    } else if (req.method === "GET" && req.url === "/account/certificates/catalog/17") {
      response = { success: true, product, raw_response: "must-not-leak" };
    } else if (req.method === "GET" && req.url === "/account/certificates") {
      response = { success: true, records: [customerOrder] };
    } else if (req.method === "GET" && req.url === `/account/certificates/${ORDER_ID}`) {
      response = { success: true, order: customerOrder };
    } else if (req.method === "POST" && req.url === "/account/certificates/quote") {
      response = quoteResponse();
    } else if (req.method === "POST" && req.url === "/account/certificates/order") {
      response = {
        success: true,
        replayed: false,
        redirect: null,
        payment_id: 99,
        order: customerOrder,
        refund_policy: "Certificate authority policy applies.",
        provider_secret: "must-not-leak",
      };
    } else if (
      req.method === "GET"
      && req.url === `/account/certificates/${ORDER_ID}/validation`
    ) {
      response = {
        success: true,
        validation: {
          order_id: ORDER_ID,
          state: "pending",
          domains: [{
            identifier: "www.example.com",
            validation_method: "dns-txt",
            approved: false,
            challenge: { file_name: "_acme-challenge.www.example.com", value: "public-dcv-value" },
            validated_at: null,
            provider_token: "must-not-leak",
          }],
        },
      };
    } else if (
      req.method === "GET"
      && req.url === `/account/certificates/${ORDER_ID}/download`
    ) {
      response = {
        success: true,
        artifact: {
          order_id: ORDER_ID,
          generation: 1,
          certificate_pem: "-----BEGIN CERTIFICATE-----\nLEAF\n-----END CERTIFICATE-----\n",
          chain_pem: "-----BEGIN CERTIFICATE-----\nCHAIN\n-----END CERTIFICATE-----\n",
          fullchain_pem: "-----BEGIN CERTIFICATE-----\nFULL\n-----END CERTIFICATE-----\n",
          certificate_sha256: "b".repeat(64),
          identifiers: ["www.example.com"],
          not_before: "2026-08-19 10:00:00",
          not_after: "2027-08-19 10:00:00",
          fetched_at: "2026-08-19 10:02:00",
          private_key_included: false,
          private_key: "must-not-leak",
        },
      };
    } else if (
      req.method === "GET"
      && req.url === `/account/certificates/${ORDER_ID}/actions`
    ) {
      response = { success: true, records: [action] };
    } else if (
      req.method === "POST"
      && req.url === `/account/certificates/${ORDER_ID}/refresh`
    ) {
      status = 202;
      response = { success: true, reconciliation_queued: true };
    } else if (
      req.method === "POST"
      && req.url === `/account/certificates/${ORDER_ID}/actions/resend_validation`
    ) {
      status = 202;
      response = { success: true, action };
    } else {
      status = 404;
      response = { certificateOrderNotFound: true, message: "internal raw message" };
    }

    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(response));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());

  const client = new Client({ name: "certificate-tools", version: "1.0.0" });
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

const orderInput = {
  product_id: 17,
  offer_id: 71,
  offer_generation: 4,
  common_name: identifier,
  alternative_names: [],
  csr: CSR,
  administrator_contact_id: 7,
  technical_contact_id: 8,
};

test("certificate tools expose the complete customer-safe contract", async (t) => {
  const { client, requests } = await harness(t);
  const { tools } = await client.listTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const names = [
    "list_certificate_catalog",
    "get_certificate_catalog_product",
    "list_certificates",
    "get_certificate",
    "quote_certificate",
    "order_certificate",
    "get_certificate_validation",
    "download_certificate",
    "list_certificate_actions",
    "refresh_certificate",
    "manage_certificate",
  ];
  for (const name of names) assert.equal(byName.has(name), true, `${name} is registered`);

  assert.equal(byName.get("list_certificate_catalog").annotations.readOnlyHint, true);
  assert.equal(byName.get("order_certificate").annotations.destructiveHint, true);
  assert.equal(
    byName.get("order_certificate").inputSchema.properties
      .acknowledge_exact_quote_and_payment.const,
    true
  );
  assert.equal(
    byName.get("manage_certificate").inputSchema.properties
      .acknowledge_certificate_action.const,
    true
  );
  assert.match(byName.get("download_certificate").description, /never includes.*private key/i);
  assert.match(byName.get("list_certificate_catalog").description, /not limited to managed applications/i);
  assert.doesNotMatch(
    JSON.stringify(names.map((name) => byName.get(name))),
    /GoGetSSL|provider_cost|wholesale/i
  );

  const results = [];
  results.push(await client.callTool({ name: "list_certificate_catalog", arguments: {} }));
  results.push(await client.callTool({
    name: "get_certificate_catalog_product",
    arguments: { product_id: 17 },
  }));
  results.push(await client.callTool({ name: "list_certificates", arguments: {} }));
  results.push(await client.callTool({
    name: "get_certificate",
    arguments: { certificate_order_id: ORDER_ID },
  }));
  const quoted = await client.callTool({
    name: "quote_certificate",
    arguments: { ...orderInput, idempotencyKey: IDEMPOTENCY_KEY },
  });
  results.push(quoted);
  assert.equal(JSON.parse(quoted.content[0].text).quote.amount.total, "24.19");
  assert.equal(JSON.parse(quoted.content[0].text).quote_token, QUOTE_TOKEN);

  results.push(await client.callTool({
    name: "order_certificate",
    arguments: {
      ...orderInput,
      quote_token: QUOTE_TOKEN,
      payment: { payment: 1, successUrl: "", cancelUrl: "" },
      acknowledge_exact_quote_and_payment: true,
      idempotencyKey: IDEMPOTENCY_KEY,
    },
  }));
  results.push(await client.callTool({
    name: "get_certificate_validation",
    arguments: { certificate_order_id: ORDER_ID },
  }));
  const artifact = await client.callTool({
    name: "download_certificate",
    arguments: { certificate_order_id: ORDER_ID },
  });
  results.push(artifact);
  assert.equal(JSON.parse(artifact.content[0].text).artifact.private_key_included, false);
  results.push(await client.callTool({
    name: "list_certificate_actions",
    arguments: { certificate_order_id: ORDER_ID },
  }));
  results.push(await client.callTool({
    name: "refresh_certificate",
    arguments: { certificate_order_id: ORDER_ID },
  }));
  results.push(await client.callTool({
    name: "manage_certificate",
    arguments: {
      certificate_order_id: ORDER_ID,
      request: { action: "resend_validation" },
      acknowledge_certificate_action: true,
      idempotencyKey: ACTION_KEY,
    },
  }));

  const modelContext = results.map((result) => result.content[0].text).join("\n");
  assert.doesNotMatch(
    modelContext,
    /must-not-leak|provider_(?:cost|order|product|response|token|secret)|request_ciphertext|last_error_code|private_key\b/i
  );
  assert.match(modelContext, /public-dcv-value/);
  assert.match(modelContext, /Example Trust/);

  const quoteRequest = requests.find((request) => request.url.endsWith("/quote"));
  assert.equal(quoteRequest.headers["idempotency-key"], IDEMPOTENCY_KEY);
  assert.deepEqual(quoteRequest.body, orderInput);
  const orderRequest = requests.find((request) => request.url.endsWith("/order"));
  assert.equal(orderRequest.headers["idempotency-key"], IDEMPOTENCY_KEY);
  assert.equal(orderRequest.headers["x-quote-token"], QUOTE_TOKEN);
  assert.deepEqual(orderRequest.body, {
    ...orderInput,
    quoteToken: QUOTE_TOKEN,
    payment: { payment: 1, successUrl: "", cancelUrl: "" },
  });
  const manageRequest = requests.find((request) => request.url.endsWith("/resend_validation"));
  assert.equal(manageRequest.headers["idempotency-key"], ACTION_KEY);
  assert.deepEqual(manageRequest.body, {});
});

test("certificate schemas reject private keys and invalid wildcard validation before HTTP", async (t) => {
  const { client, requests } = await harness(t);
  const privateKey = await client.callTool({
    name: "quote_certificate",
    arguments: {
      ...orderInput,
      csr: "-----BEGIN PRIVATE KEY-----\n" + "A".repeat(128) + "\n-----END PRIVATE KEY-----\n",
      idempotencyKey: IDEMPOTENCY_KEY,
    },
  });
  assert.equal(privateKey.isError, true);

  const wildcard = await client.callTool({
    name: "quote_certificate",
    arguments: {
      ...orderInput,
      common_name: { name: "*.example.com", validation_method: "http" },
      idempotencyKey: IDEMPOTENCY_KEY,
    },
  });
  assert.equal(wildcard.isError, true);
  assert.equal(requests.filter((request) => request.url.endsWith("/quote")).length, 0);
});

test("certificate error projection omits raw messages", async (t) => {
  const { client } = await harness(t);
  const result = await client.callTool({
    name: "get_certificate",
    arguments: { certificate_order_id: "550e8400-e29b-41d4-a716-446655440099" },
  });
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.success, false);
  assert.deepEqual(payload.errors, ["certificateOrderNotFound"]);
  assert.doesNotMatch(result.content[0].text, /internal raw message/);
});

test("certificate projection fails closed on non-EUR or private-key artifacts", () => {
  const nonEur = quoteResponse();
  nonEur.quote.amount.currency = "USD";
  const quote = safeCertificatePayload("quote", 200, nonEur);
  assert.equal(quote.success, false);
  assert.deepEqual(quote.errors, ["invalidCertificateResponse"]);

  const artifact = safeCertificatePayload("artifact", 200, {
    success: true,
    artifact: {
      order_id: ORDER_ID,
      generation: 1,
      certificate_pem: "-----BEGIN CERTIFICATE-----\nLEAF\n-----END CERTIFICATE-----\n",
      chain_pem: "-----BEGIN CERTIFICATE-----\nCHAIN\n-----END CERTIFICATE-----\n",
      fullchain_pem: "-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----\n",
      certificate_sha256: "b".repeat(64),
      identifiers: ["www.example.com"],
      not_before: "2026-08-19 10:00:00",
      not_after: "2027-08-19 10:00:00",
      fetched_at: "2026-08-19 10:02:00",
      private_key_included: false,
    },
  });
  assert.equal(artifact.success, false);
  assert.deepEqual(artifact.errors, ["invalidCertificateResponse"]);
});
