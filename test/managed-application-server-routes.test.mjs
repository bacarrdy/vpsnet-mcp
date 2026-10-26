import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function connect(t, requests, status = 200, reply = { success: true }) {
  const api = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(reply));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());
  const client = new Client({ name: "server-routes-contract", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    env: { ...process.env, VPSNET_API_KEY: "contract-test-key", VPSNET_API_URL: `http://127.0.0.1:${api.address().port}` },
  }));
  t.after(async () => client.close());
  return client;
}

test("get_application_server_routes is a read-only GET", async (t) => {
  const requests = [];
  const client = await connect(t, requests, 200, { success: true, revision: 3, routes: [] });
  const { tools } = await client.listTools();
  const tool = tools.find((x) => x.name === "get_application_server_routes");
  assert.equal(tool.annotations.readOnlyHint, true);
  await client.callTool({ name: "get_application_server_routes", arguments: { orderNo: "VP123" } });
  assert.equal(requests[0].method, "GET");
  assert.match(requests[0].url, /\/account\/services\/VP123\/applications\/server-routes$/);
});

test("configure_application_server_routes PUTs the complete set with idempotency", async (t) => {
  const requests = [];
  const client = await connect(t, requests, 202, {
    success: true, replayed: false, no_op: false, revision: 4,
    action: { id: "a1", type: "configure_routes", state: "queued" },
  });
  const { tools } = await client.listTools();
  const tool = tools.find((x) => x.name === "configure_application_server_routes");
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.match(tool.description, /REPLACES the COMPLETE set/);
  assert.match(tool.description, /at least one installed managed application/);
  const result = await client.callTool({
    name: "configure_application_server_routes",
    arguments: {
      orderNo: "VP123",
      expected_revision: 3,
      routes: [{ hostname: "app.example.com", upstream: { scheme: "http", port: 3000 } }],
      fallback: { http_port: 8080, https_port: 8443 },
      idempotencyKey: "server-routes-key-0001",
      confirmed: true,
    },
  });
  assert.notEqual(result.isError, true);
  assert.equal(requests[0].method, "PUT");
  assert.match(requests[0].url, /\/applications\/server-routes$/);
  assert.equal(requests[0].headers["idempotency-key"], "server-routes-key-0001");
  assert.deepEqual(requests[0].body, {
    expectedRevision: 3,
    routes: [{ hostname: "app.example.com", upstream: { scheme: "http", port: 3000 } }],
    fallback: { http_port: 8080, https_port: 8443 },
    confirmed: true,
  });
});

test("configure_application_server_routes rejects reserved ports and unconfirmed calls", async (t) => {
  const requests = [];
  const client = await connect(t, requests);
  for (const args of [
    { routes: [{ hostname: "a.example.com", upstream: { scheme: "http", port: 10443 } }], confirmed: true },
    { routes: [{ hostname: "a.example.com", upstream: { scheme: "http", port: 80 } }], confirmed: true },
    { routes: [], confirmed: false },
  ]) {
    const result = await client.callTool({
      name: "configure_application_server_routes",
      arguments: { orderNo: "VP123", expected_revision: 0, idempotencyKey: "server-routes-key-0002", ...args },
    }).catch((e) => ({ isError: true, e }));
    assert.equal(result.isError, true);
  }
  assert.equal(requests.length, 0);
});
