import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const GATEWAY = "2f186a34-88a3-49fc-93e8-71931b212867";
const PEER = "a22093d5-985a-443c-9a93-e0dcf6609d84";
const NETWORK = "550e8400-e29b-41d4-a716-446655440000";
const KEY = "vpn-site-test-key-0001";
const REVEAL = Buffer.alloc(32, 1).toString("base64");

async function harness(t, respond) {
  const requests = [];
  const api = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const request = { method: req.method, path: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
    requests.push(request);
    const answer = respond(request);
    res.writeHead(answer.status, { "content-type": "application/json" });
    res.end(JSON.stringify(answer.body));
  });
  await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
  t.after(async () => { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); });
  const client = new Client({ name: "vpn-site", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["build/index.js"],
    env: { PATH: process.env.PATH, VPSNET_API_KEY: "contract-test-key", VPSNET_API_URL: `http://127.0.0.1:${api.address().port}` } }));
  t.after(() => client.close());
  return { client, requests, call: (name, args) => client.callTool({ name, arguments: args }) };
}

test("VPN site tools are scoped, annotated and send the exact documented requests", async t => {
  const { client, requests, call } = await harness(t, request => {
    if (request.path.includes("/history")) return { status: 200, body: { range: "30d", resolution: "minute", step_seconds: 3600, points: [{ t: "2026-10-17T00:00:00Z", rx: 10, tx: 20, connected: true, last_handshake_at: "2026-10-17T00:00:12Z" }] } };
    if (request.path.endsWith("/site-options")) return { status: 200, body: { site_options: { hub_and_spoke: true, hub_and_spoke_applied: false, route_mode: "dhcp" } } };
    if (request.path.endsWith("/site-alert")) return { status: 200, body: { site_alert: { enabled: true, state: null } } };
    if (request.path.endsWith("/site-route-mode")) return { status: 200, body: { network_id: NETWORK, site_route_mode: "router", changed: true } };
    return { status: 202, body: { peer: { id: PEER }, operation: { id: PEER, in_progress: true, state: "queued", reason_code: "appliance_dispatch_pending", reason_kind: "waiting" }, stream_version: 3 } };
  });
  const tools = (await client.listTools()).tools;
  const find = name => { const found = tools.find(item => item.name === name); assert.ok(found, name); return found; };
  assert.equal(find("get_network_vpn_peer_history").annotations.readOnlyHint, true);
  assert.match(find("get_network_vpn_peer_history").description, /explicit networking:read/);
  for (const name of ["set_network_vpn_site_options", "set_network_vpn_site_alert", "set_network_site_route_mode"]) {
    assert.equal(find(name).annotations.readOnlyHint, false, name);
    assert.match(find(name).description, /networking:manage/, name);
  }
  assert.equal(find("set_network_vpn_site_options").annotations.destructiveHint, true);
  assert.match(find("get_network_vpn_gateway").description, /current_endpoint/);
  assert.doesNotMatch(find("get_network_vpn_summary").description, /not supported/);

  const history = await call("get_network_vpn_peer_history", { gateway_id: GATEWAY, peer_id: PEER, range: "30d" });
  assert.equal(requests.at(-1).method, "GET");
  assert.equal(requests.at(-1).path, `/account/networking/appliances/vpn-gateways/${GATEWAY}/peers/${PEER}/history?range=30d`);
  assert.equal(JSON.parse(history.content[0].text).points[0].rx, 10);
  const refused = await call("get_network_vpn_peer_history", { gateway_id: GATEWAY, peer_id: PEER, range: "1y" });
  assert.equal(refused.isError, true);

  const options = await call("set_network_vpn_site_options", { gateway_id: GATEWAY, hub_and_spoke: true });
  assert.deepEqual({ method: requests.at(-1).method, path: requests.at(-1).path, body: requests.at(-1).body },
    { method: "PUT", path: `/account/networking/appliances/vpn-gateways/${GATEWAY}/site-options`, body: { hub_and_spoke: true } });
  assert.match(options.content.at(-1).text, /get_network_vpn_gateway/);

  await call("set_network_vpn_site_alert", { gateway_id: GATEWAY, peer_id: PEER, enabled: true });
  assert.deepEqual({ method: requests.at(-1).method, path: requests.at(-1).path, body: requests.at(-1).body },
    { method: "PUT", path: `/account/networking/appliances/vpn-gateways/${GATEWAY}/peers/${PEER}/site-alert`, body: { enabled: true } });

  await call("set_network_site_route_mode", { network_id: NETWORK, route_mode: "router" });
  assert.deepEqual({ method: requests.at(-1).method, path: requests.at(-1).path, body: requests.at(-1).body },
    { method: "PUT", path: `/account/networking/appliances/networks/${NETWORK}/site-route-mode`, body: { route_mode: "router" } });

  await call("create_network_vpn_peer", { gateway_id: GATEWAY, name: "office-vilnius", grants: ["100.64.0.10"], reveal_public_key: REVEAL, kind: "site_to_site",
    site: { remote_prefixes: ["192.168.50.0/24"], endpoint: "91.225.104.20:51820" }, site_down_alert: true, idempotencyKey: KEY });
  assert.equal(requests.at(-1).headers["idempotency-key"], KEY);
  assert.deepEqual(requests.at(-1).body, { name: "office-vilnius", grants: ["100.64.0.10"], reveal_public_key: REVEAL, kind: "site_to_site",
    site: { remote_prefixes: ["192.168.50.0/24"], endpoint: "91.225.104.20:51820" }, site_down_alert: true });
  await call("create_network_vpn_peer", { gateway_id: GATEWAY, name: "laptop", grants: [], reveal_public_key: REVEAL, idempotencyKey: KEY });
  assert.deepEqual(requests.at(-1).body, { name: "laptop", grants: [], reveal_public_key: REVEAL }, "an ordinary device request stays unchanged");
});
