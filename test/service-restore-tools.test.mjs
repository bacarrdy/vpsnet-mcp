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
//
// Since backend 1fbcf253a the confirm is also a confirmation of a price the
// customer already saw: ServiceRestoreController::restoreInput(true) refuses
// it with 422 restoreRequestInvalid unless acknowledgeDataReplacement and
// acknowledgeRestoreCharge are literally true and expectedTotalCharged is a
// finite number >= 0, and it refuses the charge with 409 restoreQuoteChanged
// when the live quote has moved from it. Its allow-list is exact, so an extra
// key is a refusal rather than something ignored. These assertions therefore
// name one required field at a time: a body asserted as a whole is what let
// the old shape stay green while certifying a break.

const QUOTE_TOKEN = "q".repeat(64);
const IDEMPOTENCY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,189}$/;
const QUOTED_TOTAL = 6.05;

// What the tool's caller disclosed to the user and is confirming.
const CONFIRMATION = {
  acknowledge_data_replacement: true,
  acknowledge_restore_charge: true,
  expected_total_charged: QUOTED_TOTAL,
};

// Every key the confirmation endpoint accepts. Anything else is a 422.
const CONFIRM_ALLOWED = new Set([
  "backup_point_id",
  "idempotencyKey",
  "orderNo",
  "comment",
  "quoteToken",
  "acknowledgeDataReplacement",
  "acknowledgeRestoreCharge",
  "expectedTotalCharged",
]);

function assertConfirmationBody(body) {
  assert.equal(
    body.acknowledgeDataReplacement,
    true,
    "without it the API answers 422 restoreRequestInvalid"
  );
  assert.equal(
    body.acknowledgeRestoreCharge,
    true,
    "without it the API answers 422 restoreRequestInvalid"
  );
  assert.equal(
    body.expectedTotalCharged,
    QUOTED_TOTAL,
    "the disclosed total must be sent back, not a recomputed one"
  );
  for (const key of Object.keys(body)) {
    assert.ok(
      CONFIRM_ALLOWED.has(key),
      `${key} is outside the API allow-list and would refuse the call`
    );
  }
}

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

async function withServer(t, { quoteResponse, confirmResponse } = {}) {
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
            total_charged: QUOTED_TOTAL,
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
      if (confirmResponse) {
        ({ status, response } = confirmResponse);
      } else if (!req.headers["idempotency-key"]) {
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
    arguments: { orderNo: "VP123", backup_point_id: 7, ...CONFIRMATION },
  });

  assert.equal(requests.length, 2);
  const [quote, confirm] = requests;

  assert.equal(quote.url, "/account/services/VP123/restore/requests/quote");
  assert.deepEqual(
    quote.body,
    { backup_point_id: 7 },
    "the quote stage is unchanged: it takes the point alone"
  );
  const key = quote.headers["idempotency-key"];
  assert.match(key, IDEMPOTENCY_RE, "generated key satisfies backend format");

  assert.equal(confirm.url, "/account/services/VP123/restore/requests");
  assert.equal(confirm.headers["idempotency-key"], key, "same key on confirm");
  assert.equal(confirm.headers["x-quote-token"], QUOTE_TOKEN);
  assert.equal(confirm.body.backup_point_id, 7);
  assert.equal(confirm.body.quoteToken, QUOTE_TOKEN);
  assertConfirmationBody(confirm.body);

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
      ...CONFIRMATION,
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
    arguments: { orderNo: "VP123", backup_point_id: 7, ...CONFIRMATION },
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
      ...CONFIRMATION,
      idempotencyKey: "restore-attempt-0001",
    },
  });

  assert.equal(requests.length, 2);
  const confirm = requests[1];
  assert.equal(confirm.url, "/account/services/VP123/restore/requests");
  assert.equal(confirm.headers["idempotency-key"], "restore-attempt-0001");
  assert.equal(confirm.headers["x-quote-token"], undefined);
  assert.equal(confirm.body.backup_point_id, 7);
  // restoreInput() runs before the replay is resolved, so a replay body
  // without the confirmation is refused just like a first attempt.
  assertConfirmationBody(confirm.body);

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.replayed, true, "replay returns the existing request");
});

test("a confirmation missing an acknowledgement never reaches the API", async (t) => {
  const { client, requests } = await withServer(t);

  for (const missing of [
    "acknowledge_data_replacement",
    "acknowledge_restore_charge",
    "expected_total_charged",
  ]) {
    const { [missing]: _dropped, ...partial } = CONFIRMATION;
    const refused = await client.callTool({
      name: "request_restore",
      arguments: { orderNo: "VP123", backup_point_id: 7, ...partial },
    });
    assert.equal(refused.isError, true, `${missing} is required`);
  }

  // The agreement is the caller's to give, so a missing one is refused here
  // rather than filled in: nothing is quoted and nothing is charged.
  assert.equal(requests.length, 0);
});

test("a total that moved is refused before the confirm, with the new price", async (t) => {
  const { client, requests } = await withServer(t);

  const refused = await client.callTool({
    name: "request_restore",
    arguments: {
      orderNo: "VP123",
      backup_point_id: 7,
      ...CONFIRMATION,
      expected_total_charged: 4.2,
    },
  });

  assert.equal(refused.isError, true);
  assert.equal(requests.length, 1, "the confirm is never sent");
  const payload = JSON.parse(refused.content[0].text);
  assert.deepEqual(payload.error_codes, ["restoreQuoteChanged"]);
  assert.equal(payload.expected_total_charged, 4.2);
  assert.equal(
    payload.current_total_charged,
    QUOTED_TOTAL,
    "the caller is handed the price it now has to disclose"
  );
});

test("sub-cent rounding of the disclosed total still confirms", async (t) => {
  const { client, requests } = await withServer(t);

  await client.callTool({
    name: "request_restore",
    arguments: {
      orderNo: "VP123",
      backup_point_id: 7,
      ...CONFIRMATION,
      expected_total_charged: QUOTED_TOTAL + 0.004,
    },
  });

  assert.equal(requests.length, 2, "within the backend's 0.005 EUR tolerance");
  assert.equal(requests[1].url, "/account/services/VP123/restore/requests");
});

// The pre-check above only knows the total the quote just returned. The price
// can still move between that quote and the confirm, and the confirm can be
// refused for a contract reason the tool cannot predict. Both come back as a
// bare `{ "restoreQuoteChanged": true }` / `{ "restoreRequestInvalid": true }`
// body under a status code the MCP caller never sees, which is indistinguishable
// from a successful response to an agent reading only the JSON. They are
// projected into an explicit refusal instead.
test("a moved price refused by the server is explained, not handed back as a bare code", async (t) => {
  const { client, requests } = await withServer(t, {
    confirmResponse: { status: 409, response: { restoreQuoteChanged: true } },
  });

  const refused = await client.callTool({
    name: "request_restore",
    arguments: { orderNo: "VP123", backup_point_id: 7, ...CONFIRMATION },
  });

  assert.equal(requests.length, 2, "the confirm was sent and refused");
  assert.equal(refused.isError, true, "a refusal must not read as a success");
  const payload = JSON.parse(refused.content[0].text);
  assert.equal(payload.success, false);
  assert.deepEqual(payload.error_codes, ["restoreQuoteChanged"]);
  // The refusal happens before any ledger row or payment exists, and the
  // caller has to be told that before it decides whether to retry.
  assert.match(payload.reason, /not charged/i);
  // The server does not send the new total, so the caller must be sent back
  // to the free status read rather than left to invent one.
  assert.match(payload.fix, /get_restore_status/);
});

test("a confirmation the server refuses as invalid is explained", async (t) => {
  const { client } = await withServer(t, {
    confirmResponse: { status: 422, response: { restoreRequestInvalid: true } },
  });

  const refused = await client.callTool({
    name: "request_restore",
    arguments: { orderNo: "VP123", backup_point_id: 7, ...CONFIRMATION },
  });

  assert.equal(refused.isError, true);
  const payload = JSON.parse(refused.content[0].text);
  assert.equal(payload.success, false);
  assert.deepEqual(payload.error_codes, ["restoreRequestInvalid"]);
  assert.match(payload.reason, /not charged/i);
});

test("a replay refused by the server is explained too", async (t) => {
  const { client } = await withServer(t, {
    quoteResponse: {
      status: 409,
      response: { idempotencyKeyAlreadyUsed: true, state: "captured" },
    },
    confirmResponse: { status: 422, response: { restoreRequestInvalid: true } },
  });

  const refused = await client.callTool({
    name: "request_restore",
    arguments: {
      orderNo: "VP123",
      backup_point_id: 7,
      ...CONFIRMATION,
      idempotencyKey: "restore-attempt-0001",
    },
  });

  // restoreInput() runs ahead of the replay lookup, so the replay body is
  // refused by the same fence and needs the same explanation.
  assert.equal(refused.isError, true);
  const payload = JSON.parse(refused.content[0].text);
  assert.deepEqual(payload.error_codes, ["restoreRequestInvalid"]);
});
