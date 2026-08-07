import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// The backend contract for API-key whole-service restore is:
//   POST restore/requests/quote  (Idempotency-Key)          -> quoteToken
//   POST restore/requests        (same key + quoteToken)    -> charged request
// A bare POST without the key is refused with idempotencyKeyRequired, and a
// confirm without the token with quoteTokenRequired. These tests pin the tool
// to that two-step flow without ever touching a real service.

const QUOTE_TOKEN = "q".repeat(64);
const IDEMPOTENCY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,189}$/;

function restoreRequestPayload(replayed) {
  return {
    success: true,
    replayed,
    request: {
      id: 42,
      status: "paid",
      restore_scope: "full_service",
      backup_point_id: 7,
      total_charged: 6.05,
    },
  };
}

async function withServer(t, { quoteResponse } = {}) {
  const requests = [];
  const api = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: body ? JSON.parse(body) : null,
    });

    let status = 200;
    let response;
    if (
      req.method === "POST"
      && req.url === "/account/services/VP123/restore/requests/quote"
    ) {
      ({ status, response } = quoteResponse ?? {
        status: 200,
        response: {
          success: true,
          quote: {
            price_ex_vat: 5,
            total_charged: 6.05,
            balance: 25,
            balance_sufficient: true,
          },
          quoteToken: QUOTE_TOKEN,
          quoteExpiresAt: "2026-08-07 13:00:00",
        },
      });
    } else if (
      req.method === "POST"
      && req.url === "/account/services/VP123/restore/requests"
    ) {
      if (!req.headers["idempotency-key"]) {
        status = 400;
        response = { idempotencyKeyRequired: true };
      } else if (req.headers["x-quote-token"] === QUOTE_TOKEN) {
        status = 202;
        response = restoreRequestPayload(false);
      } else {
        // No/foreign token: the backend resolves the key as a replay of the
        // already-created request instead of charging again.
        status = 200;
        response = restoreRequestPayload(true);
      }
    } else {
      status = 404;
      response = { notFound: true };
    }

    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(response));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());

  const client = new Client({ name: "service-restore", version: "1.0.0" });
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

test("request_restore quotes then confirms under one generated idempotency key", async (t) => {
  const { client, requests } = await withServer(t);

  const result = await client.callTool({
    name: "request_restore",
    arguments: { orderNo: "VP123", backup_point_id: 7 },
  });

  assert.equal(requests.length, 2);
  const [quote, confirm] = requests;

  assert.equal(quote.url, "/account/services/VP123/restore/requests/quote");
  assert.deepEqual(quote.body, { backup_point_id: 7 });
  const key = quote.headers["idempotency-key"];
  assert.match(key, IDEMPOTENCY_RE, "generated key satisfies backend format");

  assert.equal(confirm.url, "/account/services/VP123/restore/requests");
  assert.equal(confirm.headers["idempotency-key"], key, "same key on confirm");
  assert.equal(confirm.headers["x-quote-token"], QUOTE_TOKEN);
  assert.deepEqual(confirm.body, {
    backup_point_id: 7,
    quoteToken: QUOTE_TOKEN,
  });

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.success, true);
  assert.equal(payload.replayed, false);
  assert.equal(payload.request.status, "paid");
});

test("request_restore reuses a caller-supplied idempotency key verbatim", async (t) => {
  const { client, requests } = await withServer(t);

  await client.callTool({
    name: "request_restore",
    arguments: {
      orderNo: "VP123",
      backup_point_id: 7,
      idempotencyKey: "restore-attempt-0001",
    },
  });

  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.headers["idempotency-key"], "restore-attempt-0001");
  }
});

test("a quote-stage denial is surfaced and nothing is confirmed", async (t) => {
  const { client, requests } = await withServer(t, {
    quoteResponse: {
      status: 403,
      response: { paidOperationsDisabled: true, requiredScope: "services:restore" },
    },
  });

  const result = await client.callTool({
    name: "request_restore",
    arguments: { orderNo: "VP123", backup_point_id: 7 },
  });

  assert.equal(requests.length, 1, "no confirm call after a denied quote");
  assert.equal(requests[0].url, "/account/services/VP123/restore/requests/quote");

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.paidOperationsDisabled, true);
});

test("an already-used key falls through to the backend replay without a token", async (t) => {
  const { client, requests } = await withServer(t, {
    quoteResponse: {
      status: 409,
      response: { idempotencyKeyAlreadyUsed: true, state: "captured" },
    },
  });

  const result = await client.callTool({
    name: "request_restore",
    arguments: {
      orderNo: "VP123",
      backup_point_id: 7,
      idempotencyKey: "restore-attempt-0001",
    },
  });

  assert.equal(requests.length, 2);
  const confirm = requests[1];
  assert.equal(confirm.url, "/account/services/VP123/restore/requests");
  assert.equal(confirm.headers["idempotency-key"], "restore-attempt-0001");
  assert.equal(confirm.headers["x-quote-token"], undefined);
  assert.deepEqual(confirm.body, { backup_point_id: 7 });

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.replayed, true, "replay returns the existing request");
});
