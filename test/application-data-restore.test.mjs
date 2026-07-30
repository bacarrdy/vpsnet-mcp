import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const INSTALLATION_ID = "11111111-1111-4111-8111-111111111111";
const BACKUP_POINT_ID = "22222222-2222-4222-8222-222222222222";
const RESTORE_ID = "33333333-3333-4333-8333-333333333333";
const QUOTE_TOKEN = `vpsnet_quote_${"q".repeat(48)}`;

const restore = (state = "queued") => ({
  id: RESTORE_ID,
  installationId: INSTALLATION_ID,
  backupPointId: BACKUP_POINT_ID,
  state,
  progress: {
    percent: state === "succeeded" ? 100 : 0,
    stage: state === "succeeded" ? "completed" : "queued",
  },
  restoreMode: state === "succeeded" ? "staged" : null,
  restoredBytes: state === "succeeded" ? 4096 : null,
  restoredItems: state === "succeeded" ? 2 : null,
  healthStatus: state === "succeeded" ? "healthy" : null,
  errorCode: null,
  createdAt: "2026-07-30T08:00:00Z",
  completedAt: state === "succeeded" ? "2026-07-30T08:03:00Z" : null,
  pbs_repository: "must-not-leak",
  filesystem_paths: ["/must-not-leak"],
});

test("application restore tools preserve the narrow HTTP contract", async (t) => {
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
    if (req.url.endsWith("/restore-points")) {
      response = {
        success: true,
        points: [{
          id: BACKUP_POINT_ID,
          capturedAt: "2026-07-30T02:00:00Z",
          expiresAt: "2026-08-06T02:00:00Z",
          sizeBytes: 10_485_760,
          consistency: "application",
          archiveId: "must-not-leak",
        }],
        quote: {
          price_ex_vat: 5,
          vat_rate: 21,
          total_charged: 6.05,
          balance: 25,
          balance_sufficient: true,
        },
        activeRestore: restore(),
      };
    } else if (req.method === "POST" && req.url.endsWith("/restores/quote")) {
      response = {
        success: true,
        quote: {
          price_ex_vat: 5,
          vat_rate: 21,
          total_charged: 6.05,
          balance: 25,
          balance_sufficient: true,
        },
        quoteToken: QUOTE_TOKEN,
        quoteExpiresAt: "2026-07-30T08:15:00Z",
      };
    } else if (req.method === "POST" && req.url.endsWith("/restores")) {
      status = 202;
      response = {
        success: true,
        replayed: false,
        restore: restore(),
      };
    } else if (req.method === "GET" && req.url.endsWith(`/restores/${RESTORE_ID}`)) {
      response = {
        success: true,
        restore: restore("succeeded"),
      };
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
  const address = api.address();

  const client = new Client({ name: "application-restore", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    env: {
      ...process.env,
      VPSNET_API_KEY: "contract-test-key",
      VPSNET_API_URL: `http://127.0.0.1:${address.port}`,
    },
  });
  await client.connect(transport);
  t.after(async () => client.close());

  const listed = await client.callTool({
    name: "list_application_restore_points",
    arguments: {
      orderNo: "VP123",
      installation_id: INSTALLATION_ID,
    },
  });
  assert.equal(
    requests[0].url,
    `/account/services/VP123/applications/installations/${INSTALLATION_ID}/restore-points`
  );
  assert.match(listed.content[0].text, /10485760/);
  assert.doesNotMatch(
    listed.content[0].text,
    /must-not-leak|archiveId|pbs_repository|filesystem_paths/
  );

  const shortKey = await client.callTool({
    name: "quote_application_data_restore",
    arguments: {
      orderNo: "VP123",
      installation_id: INSTALLATION_ID,
      backup_point_id: BACKUP_POINT_ID,
      expected_revision: 7,
      idempotencyKey: "too-short",
    },
  });
  assert.equal(shortKey.isError, true);
  assert.equal(requests.length, 1);

  const quoted = await client.callTool({
    name: "quote_application_data_restore",
    arguments: {
      orderNo: "VP123",
      installation_id: INSTALLATION_ID,
      backup_point_id: BACKUP_POINT_ID,
      expected_revision: 7,
      idempotencyKey: "restore-application-0001",
    },
  });
  assert.equal(
    requests[1].url,
    `/account/services/VP123/applications/installations/${INSTALLATION_ID}/restores/quote`
  );
  assert.equal(
    requests[1].headers["idempotency-key"],
    "restore-application-0001"
  );
  assert.match(quoted.content[0].text, /6\.05/);
  assert.match(quoted.content[0].text, /vpsnet_quote_/);

  const started = await client.callTool({
    name: "restore_application_data",
    arguments: {
      orderNo: "VP123",
      installation_id: INSTALLATION_ID,
      backup_point_id: BACKUP_POINT_ID,
      expected_revision: 7,
      acknowledge_data_replacement: true,
      acknowledge_restore_charge: true,
      quote_token: QUOTE_TOKEN,
      idempotencyKey: "restore-application-0001",
    },
  });
  assert.equal(
    requests[2].url,
    `/account/services/VP123/applications/installations/${INSTALLATION_ID}/restores`
  );
  assert.deepEqual(requests[2].body, {
    orderNo: "VP123",
    backupPointId: BACKUP_POINT_ID,
    expectedRevision: 7,
    acknowledgeDataReplacement: true,
    acknowledgeRestoreCharge: true,
    quoteToken: QUOTE_TOKEN,
  });
  assert.equal(
    requests[2].headers["idempotency-key"],
    "restore-application-0001"
  );
  assert.doesNotMatch(started.content[0].text, /must-not-leak/);

  const polled = await client.callTool({
    name: "get_application_data_restore",
    arguments: {
      orderNo: "VP123",
      installation_id: INSTALLATION_ID,
      restore_id: RESTORE_ID,
    },
  });
  assert.equal(
    requests[3].url,
    `/account/services/VP123/applications/installations/${INSTALLATION_ID}/restores/${RESTORE_ID}`
  );
  assert.match(polled.content[0].text, /succeeded/);
  assert.doesNotMatch(polled.content[0].text, /must-not-leak/);
});

test("restore-point sanitizer preserves an insufficient negative balance", async () => {
  const { safeApplicationDataRestorePointsPayload } = await import(
    "../build/application-contract.js"
  );
  const payload = safeApplicationDataRestorePointsPayload(200, {
    success: true,
    points: [],
    quote: {
      price_ex_vat: 5,
      vat_rate: 21,
      total_charged: 6.05,
      balance: -1.25,
      balance_sufficient: false,
    },
    activeRestore: null,
  });

  assert.equal(payload.success, true);
  assert.equal(payload.quote.balance, -1.25);
  assert.equal(payload.quote.balance_sufficient, false);
});
