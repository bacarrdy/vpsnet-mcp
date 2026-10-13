import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function listen(server) {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

function close(server) {
  server.closeAllConnections();
  return new Promise(resolve => server.close(resolve));
}

test("DNS publication retry queues existing state once and preserves refusals", async t => {
  const requests = [];
  const backend = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, path: req.url, body });
    res.setHeader("content-type", "application/json");
    const refusal = {
      "/account/dns/zones/42/reapply": { blockedByRecord: true, apply_blocking_records: [{ id: 7, reason: "invalid_record" }] },
      "/account/dns/zones/43/reapply": { zoneNotFailed: true },
      "/account/dns/zones/44/reapply": { zoneNotPublished: true },
    }[req.url];
    if (refusal) {
      res.statusCode = 409;
      res.end(JSON.stringify({ success: false, ...refusal }));
    } else if (req.method === "POST" && req.url === "/account/dns/zones/41/reapply") {
      res.end(JSON.stringify({ success: true, apply_state: "queued" }));
    } else if (req.method === "GET" && req.url === "/account/dns/zones/41") {
      res.end(JSON.stringify({ success: true, zone: { id: 41, status: "published", apply_state: "clean" }, records: [] }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ success: false, notFound: true }));
    }
  });
  const port = await listen(backend);
  t.after(() => close(backend));
  const client = new Client({ name: "dns-reapply-test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    env: { ...process.env, VPSNET_API_KEY: "contract-test-key", VPSNET_API_URL: `http://127.0.0.1:${port}` },
  }));
  t.after(() => client.close());

  const tool = (await client.listTools()).tools.find(tool => tool.name === "reapply_dns_zone");
  assert.deepEqual(tool.inputSchema.required, ["zone_id"]);
  assert.deepEqual(tool.annotations, { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true });
  for (const zone_id of [0, -1, 1.5, "41", Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = await client.callTool({ name: "reapply_dns_zone", arguments: { zone_id } });
    assert.equal(invalid.isError, true);
  }
  assert.equal(requests.length, 0, "invalid IDs never reach the API");

  const queued = await client.callTool({ name: "reapply_dns_zone", arguments: { zone_id: 41 } });
  assert.equal(queued.isError, undefined);
  assert.deepEqual(JSON.parse(queued.content[0].text), { success: true, apply_state: "queued" });
  assert.deepEqual(requests, [{ method: "POST", path: "/account/dns/zones/41/reapply", body: "" }], "queue acceptance does not trigger retries or other mutations");
  const published = await client.callTool({ name: "get_dns_zone", arguments: { zone_id: 41 } });
  assert.equal(JSON.parse(published.content[0].text).zone.apply_state, "clean", "existing read tool follows publication");

  for (const [zone_id, flag] of [[42, "blockedByRecord"], [43, "zoneNotFailed"], [44, "zoneNotPublished"]]) {
    const before = requests.length;
    const refused = await client.callTool({ name: "reapply_dns_zone", arguments: { zone_id } });
    assert.equal(refused.isError, true);
    const payload = JSON.parse(refused.content[0].text);
    assert.equal(payload[flag], true);
    if (zone_id === 42) assert.deepEqual(payload.apply_blocking_records, [{ id: 7, reason: "invalid_record" }]);
    assert.equal(requests.length, before + 1, "refusal is not retried or bypassed by changing records");
  }
});

test("remote DNS publication retry advertises and enforces existing dns:write consent", async t => {
  const resource = "https://mcp.vpsnet.com/mcp";
  const issuer = "https://api.vpsnet.com/oauth/mcp";
  const readToken = "vpsnet_" + "a".repeat(43);
  const writeToken = "vpsnet_" + "b".repeat(43);
  const mutations = [];
  const backend = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/oauth/mcp/introspect") {
      const write = req.headers.authorization === `Bearer ${writeToken}`;
      res.end(JSON.stringify({ active: true, aud: resource, iss: issuer, exp: Date.now() / 1000 + 300, sub: "test", grant_id: write ? "write" : "read", scope: write ? "dns:write" : "dns:read", services: [] }));
      return;
    }
    mutations.push({ method: req.method, path: req.url, authorization: req.headers.authorization, apiKey: req.headers["x-api-key"] });
    res.end(JSON.stringify({ success: true, apply_state: "queued" }));
  });
  process.env.VPSNET_API_URL = `http://127.0.0.1:${await listen(backend)}`;
  const { createRemoteServer } = await import("../build/http-server.js");
  const remote = createRemoteServer({ resource, issuer });
  const port = await listen(remote);
  t.after(async () => { await close(remote); await close(backend); });
  const call = (token, method, params) => new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, method: "POST", path: "/mcp", headers: { host: "mcp.vpsnet.com", accept: "application/json, text/event-stream", "content-type": "application/json", authorization: `Bearer ${token}` } }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => body += chunk);
      res.on("end", () => resolve(JSON.parse(body).result));
    });
    req.on("error", reject);
    req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }));
  });
  const tool = (await call(readToken, "tools/list")).tools.find(tool => tool.name === "reapply_dns_zone");
  assert.deepEqual(tool._meta.securitySchemes, [{ type: "oauth2", scopes: ["dns:write"] }]);
  assert.equal(tool.annotations.openWorldHint, true);
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.equal(tool.annotations.destructiveHint, true);
  assert.equal(tool.annotations.idempotentHint, false);
  const params = { name: "reapply_dns_zone", arguments: { zone_id: 41 } };
  const denied = await call(readToken, "tools/call", params);
  assert.equal(denied.isError, true);
  assert.match(denied._meta["mcp/www_authenticate"][0], /scope="dns:write"/);
  assert.equal(mutations.length, 0);
  const queued = await call(writeToken, "tools/call", params);
  assert.equal(queued.isError, undefined);
  assert.equal(JSON.parse(queued.content[0].text).apply_state, "queued");
  assert.deepEqual(mutations, [{ method: "POST", path: "/account/dns/zones/41/reapply", authorization: `Bearer ${writeToken}`, apiKey: undefined }]);
});
