import assert from "node:assert/strict";
import { createServer } from "node:http";
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

// Owner ruling 2026-10-22 (backend !424): deleting a published zone the domain
// is delegated to VPSnet for stops the domain resolving worldwide, so the API
// answers 409 deleteRequiresConfirmation until confirm_outage=true is sent.
test("delete_dns_zone surfaces the outage refusal and sends confirm_outage only when set", async t => {
  const requests = [];
  const backend = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    requests.push({ method: req.method, path: req.url });
    res.setHeader("content-type", "application/json");
    if (req.method === "DELETE" && req.url === "/account/dns/zones/41") {
      res.statusCode = 409;
      res.end(JSON.stringify({ success: false, deleteRequiresConfirmation: true, reason: "zone_serves_domain", confirm_field: "confirm_outage", nameservers: ["ns1.vpsnet.com", "ns2.vpsnet.com"] }));
    } else if (req.method === "DELETE" && req.url === "/account/dns/zones/41?confirm_outage=true") {
      res.end(JSON.stringify({ success: true }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ success: false, notFound: true }));
    }
  });
  const port = await listen(backend);
  t.after(() => close(backend));
  const client = new Client({ name: "dns-delete-confirm-test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    env: { ...process.env, VPSNET_API_KEY: "contract-test-key", VPSNET_API_URL: `http://127.0.0.1:${port}` },
  }));
  t.after(() => client.close());

  const tool = (await client.listTools()).tools.find(candidate => candidate.name === "delete_dns_zone");
  assert.deepEqual(tool.inputSchema.required, ["zone_id"]);
  assert.equal(tool.inputSchema.properties.confirm_outage.type, "boolean");
  assert.equal(tool.inputSchema.properties.confirm_outage.default, false);
  assert.match(tool.description, /deleteRequiresConfirmation/);
  assert.match(tool.description, /only after the user explicitly confirmed/);

  const refused = await client.callTool({ name: "delete_dns_zone", arguments: { zone_id: 41 } });
  assert.equal(refused.isError, true);
  const payload = JSON.parse(refused.content[0].text);
  assert.equal(payload.deleteRequiresConfirmation, true);
  assert.equal(payload.confirm_field, "confirm_outage");
  assert.deepEqual(requests, [{ method: "DELETE", path: "/account/dns/zones/41" }], "no confirmation is sent by default and the refusal is not retried");

  const explicitFalse = await client.callTool({ name: "delete_dns_zone", arguments: { zone_id: 41, confirm_outage: false } });
  assert.equal(explicitFalse.isError, true);
  assert.equal(requests.at(-1).path, "/account/dns/zones/41");

  const deleted = await client.callTool({ name: "delete_dns_zone", arguments: { zone_id: 41, confirm_outage: true } });
  assert.equal(deleted.isError, undefined);
  assert.deepEqual(JSON.parse(deleted.content[0].text), { success: true });
  assert.equal(requests.at(-1).path, "/account/dns/zones/41?confirm_outage=true");
  assert.equal(requests.length, 3);
});
