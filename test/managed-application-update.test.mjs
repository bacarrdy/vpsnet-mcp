import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const INSTALLATION_ID = "b7ea0c2a-e6e4-4c25-87ca-c0cdf7e4ca42";
const BLUEPRINT_VERSION = "2026.07.3";
const UPSTREAM_VERSION = "1.2.3";

async function startApi(candidate = {
  blueprint_version: BLUEPRINT_VERSION,
  upstream_version: UPSTREAM_VERSION,
}) {
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

    res.setHeader("content-type", "application/json");
    if (req.method === "GET") {
      res.end(JSON.stringify({
        success: true,
        installation: {
          id: INSTALLATION_ID,
          available_actions: [{ type: "update", release: candidate }],
        },
      }));
      return;
    }
    res.statusCode = 202;
    res.end(JSON.stringify({
      success: true,
      installation: { id: INSTALLATION_ID, state: "updating" },
      action: { id: "action-1", type: "update", state: "queued" },
    }));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const address = api.address();
  return { api, requests, url: `http://127.0.0.1:${address.port}` };
}

async function connectClient(t, apiUrl) {
  const client = new Client({ name: "managed-update-contract", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    env: {
      ...process.env,
      VPSNET_API_KEY: "contract-test-key",
      VPSNET_API_URL: apiUrl,
    },
  });
  await client.connect(transport);
  t.after(async () => client.close());
  return client;
}

test("managed update rechecks the immutable candidate and posts only lifecycle action", async (t) => {
  const { api, requests, url } = await startApi();
  t.after(() => api.close());
  const client = await connectClient(t, url);

  const result = await client.callTool({
    name: "manage_application",
    arguments: {
      orderNo: "VP123",
      installation_id: INSTALLATION_ID,
      action: "update",
      expected_blueprint_version: BLUEPRINT_VERSION,
      expected_upstream_version: UPSTREAM_VERSION,
      idempotencyKey: "update-contract-key-0001",
      confirmed: true,
    },
  });

  assert.equal(result.isError, undefined);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[1].method, "POST");
  assert.deepEqual(requests[1].body, {
    action: "update",
    expected_blueprint_version: BLUEPRINT_VERSION,
    expected_upstream_version: UPSTREAM_VERSION,
  });
  assert.equal(requests[1].headers["idempotency-key"], "update-contract-key-0001");
});

test("managed update fails closed before POST when the candidate changed", async (t) => {
  const { api, requests, url } = await startApi({
    blueprint_version: "2026.07.4",
    upstream_version: "1.2.4",
  });
  t.after(() => api.close());
  const client = await connectClient(t, url);

  const result = await client.callTool({
    name: "manage_application",
    arguments: {
      orderNo: "VP123",
      installation_id: INSTALLATION_ID,
      action: "update",
      expected_blueprint_version: BLUEPRINT_VERSION,
      expected_upstream_version: UPSTREAM_VERSION,
      idempotencyKey: "update-contract-key-0002",
      confirmed: true,
    },
  });

  assert.equal(result.isError, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "GET");
  assert.match(result.content[0].text, /applicationUpdateExpectationChanged/);
});
