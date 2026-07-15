import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const INSTALLATION_ID = "b7ea0c2a-e6e4-4c25-87ca-c0cdf7e4ca42";

test("configure application access posts only the typed access contract", async (t) => {
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
    res.statusCode = 202;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      success: true,
      installation: { id: INSTALLATION_ID, state: "configuring_access" },
      action: { id: "action-1", type: "configure_access", state: "queued" },
    }));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());
  const address = api.address();

  const client = new Client({ name: "managed-access-contract", version: "1.0.0" });
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

  const result = await client.callTool({
    name: "configure_application_access",
    arguments: {
      orderNo: "VP123",
      installation_id: INSTALLATION_ID,
      access: { mode: "public_http" },
      expected_revision: 12,
      idempotencyKey: "access-contract-key-0001",
      confirmed: true,
    },
  });

  assert.equal(result.isError, undefined);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.equal(
    requests[0].url,
    `/account/services/VP123/applications/installations/${INSTALLATION_ID}/configure-access`
  );
  assert.deepEqual(requests[0].body, {
    access: { mode: "public_http" },
    expectedRevision: 12,
  });
  assert.equal(requests[0].headers["idempotency-key"], "access-contract-key-0001");
});
