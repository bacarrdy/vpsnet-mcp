import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const NETWORK = "2f186a34-88a3-49fc-93e8-71931b212867";
const RESOURCE = "a22093d5-985a-443c-9a93-e0dcf6609d84";
const KEY = "network-checkout-test-0001";

async function harness(t, respond = () => ({ status: 200, body: { accepted: true } })) {
  const requests = [];
  const api = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const request = { method: req.method, path: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
    requests.push(request);
    const answer = respond(request);
    res.writeHead(answer.status, { "content-type": typeof answer.body === "string" ? "text/html" : "application/json" });
    res.end(typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body));
  });
  await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
  t.after(async () => { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); });
  const client = new Client({ name: "networking-contract", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: ["build/index.js"],
    env: { PATH: process.env.PATH, VPSNET_API_KEY: "contract-test-key", VPSNET_API_URL: `http://127.0.0.1:${api.address().port}` },
  }));
  t.after(() => client.close());
  return { client, requests, call: (name, args = {}) => client.callTool({ name, arguments: args }) };
}

function payload(result) { return JSON.parse(result.content[0].text); }

test("networking is registered with accurate scopes, one-time annotations and package version", async t => {
  const { client, requests } = await harness(t);
  assert.equal(client.getServerVersion().version, JSON.parse(readFileSync("package.json", "utf8")).version);
  const tools = (await client.listTools()).tools;
  const find = name => { const tool = tools.find(t => t.name === name); assert.ok(tool, name); return tool; };
  for (const name of ["get_networking_capabilities", "get_network_security_policy", "list_network_load_balancers", "get_network_vpn_gateway", "list_network_public_addresses"]) {
    assert.equal(find(name).annotations.readOnlyHint, true);
    assert.match(find(name).description, /explicit networking:read/);
  }
  const oneTime = find("take_network_vpn_peer_config");
  assert.equal(oneTime.annotations.readOnlyHint, false);
  assert.equal(oneTime.annotations.idempotentHint, false);
  assert.ok(oneTime.inputSchema.required.includes("acknowledge_one_time_pickup"));
  const order = find("order_network_product");
  for (const field of ["quote_id", "quoteToken", "idempotencyKey", "acknowledge_charge", "payment"]) assert.ok(order.inputSchema.required.includes(field), field);
  assert.match(order.description, /networking:order/);
  assert.equal(order.annotations.readOnlyHint, false);
  assert.ok(!tools.some(t => /site_to_site|native_site|create_network_load_balancer|create_network_vpn_gateway/.test(t.name)));
  assert.equal(requests.length, 0);
});

test("read paths and candidate pagination preserve network ownership boundaries", async t => {
  const { call, requests } = await harness(t);
  await call("get_private_network", { network_id: NETWORK });
  await call("list_network_attachment_candidates", { network_id: NETWORK, after: "opaque+/=cursor", service_id: "VP88970" });
  await call("get_networking_topology", { metrics: "current" });
  assert.deepEqual(requests.map(r => [r.method, r.path]), [
    ["GET", `/account/networking/networks/${NETWORK}`],
    ["GET", `/account/networking/networks/${NETWORK}/attachment-candidates?after=opaque%2B%2F%3Dcursor&service_id=VP88970`],
    ["GET", "/account/networking/topology?metrics=current"],
  ]);
  assert.ok(requests.every(r => r.body === undefined));
  assert.ok(requests.every(r => r.headers["x-api-key"] === "contract-test-key"));
});

test("network schemas reject malformed IDs and unknown tenant/worker input before HTTP", async t => {
  const { call, requests } = await harness(t);
  for (const network_id of ["../account", NETWORK + "/ports", NETWORK.toUpperCase(), NETWORK + "\n", "", 42, null]) {
    assert.equal((await call("get_private_network", { network_id })).isError, true);
  }
  assert.equal((await call("get_private_network", { network_id: NETWORK, tenant_id: 1 })).isError, true);
  assert.equal((await call("create_private_network", { name: "test", idempotencyKey: KEY, settings: { worker_id: "node-1" } })).isError, true);
  assert.equal((await call("create_private_network", { name: "test", idempotencyKey: KEY, settings: { dhcp_enabled: false } })).isError, true);
  assert.equal(requests.length, 0);
});

test("port mutations preserve fixed address, generation, restart consent and original idempotency", async t => {
  const { call, requests } = await harness(t);
  await call("attach_private_network_port", { network_id: NETWORK, service_id: "VP88970", ipv4: "172.16.0.10", restart: true, idempotencyKey: KEY });
  await call("retry_private_network_port", { network_id: NETWORK, port_id: RESOURCE, expected_generation: 4, restart: true, idempotencyKey: KEY });
  assert.deepEqual(requests[0].body, { service_id: "VP88970", ipv4: "172.16.0.10", restart: true });
  assert.deepEqual(requests[1].body, { expected_generation: 4, restart: true });
  assert.equal(requests[1].path, `/account/networking/networks/${NETWORK}/ports/${RESOURCE}/retry`);
  assert.ok(requests.every(r => r.headers["idempotency-key"] === KEY));
  assert.equal((await call("detach_private_network_port", { network_id: NETWORK, port_id: RESOURCE, expected_generation: 4, restart: false, idempotencyKey: KEY })).isError, true);
  assert.equal(requests.length, 2);
});

test("security rules keep protocol and remote-selector constraints, exact policy/port revisions", async t => {
  const { call, requests } = await harness(t);
  const base = { project_id: RESOURCE, name: "Web", idempotencyKey: KEY };
  for (const bad of [
    { direction: "ingress", ether_type: "IPv4", protocol: "tcp", port_min: 80, remote_cidr: "0.0.0.0/0" },
    { direction: "ingress", ether_type: "IPv4", protocol: "any", port_min: 80, port_max: 80, remote_cidr: "0.0.0.0/0" },
    { direction: "ingress", ether_type: "IPv4", protocol: "tcp", remote_cidr: "0.0.0.0/0", remote_group_id: NETWORK },
  ]) assert.equal((await call("create_network_security_group", { ...base, rules: [bad] })).isError, true);
  assert.equal((await call("create_network_security_group", { ...base, rules: [], idempotencyKey: "invalid:sg:key" })).isError, true);
  await call("set_private_port_security_groups", { project_id: RESOURCE, network_id: NETWORK, port_id: RESOURCE, group_ids: [], expected_generation: 0, expected_port_generation: 3, idempotencyKey: KEY });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body, { group_ids: [], expected_generation: 0, expected_port_generation: 3 });
});

test("all new-purchase quotes use common checkout, preserve header key, never buy automatically", async t => {
  const { call, requests } = await harness(t, () => ({ status: 200, body: { quote: { quote_id: RESOURCE, gross_amount: "18.15", payment_flow: "common" }, quote_token: "quote-test" } }));
  await call("quote_network_product", { network_id: NETWORK, kind: "proxy_lb", tier: "alb_proxy_3", idempotencyKey: KEY });
  await call("quote_account_vpn", { network_id: NETWORK, tier: "standard", idempotencyKey: KEY });
  await call("quote_network_public_address", { network_id: NETWORK, idempotencyKey: KEY });
  assert.deepEqual(requests.map(r => r.body), [
    { kind: "proxy_lb", tier: "alb_proxy_3", prepare_after_payment: true },
    { network_id: NETWORK, tier: "standard", prepare_after_payment: true },
    { network_id: NETWORK, prepare_after_payment: true },
  ]);
  assert.ok(requests.every(r => r.headers["idempotency-key"] === KEY));
  assert.ok(requests.every(r => !r.path.includes("/product-orders")));
  assert.equal((await call("quote_network_product", { network_id: NETWORK, kind: "load_balancer", tier: "alb_proxy_3", idempotencyKey: KEY })).isError, true);
});

test("checkout needs charge approval and exact token/key and does not send acknowledgements to backend", async t => {
  const { call, requests } = await harness(t);
  const input = { quote_id: RESOURCE, idempotencyKey: KEY, quoteToken: "quote-test", payment: { payment: 1 }, target: { network_id: NETWORK, expected_generation: 3 } };
  assert.equal((await call("order_network_product", input)).isError, true);
  assert.equal((await call("order_network_product", { ...input, acknowledge_charge: false })).isError, true);
  assert.equal(requests.length, 0);
  await call("order_network_product", { ...input, acknowledge_charge: true });
  assert.deepEqual(requests[0].body, { quote_id: RESOURCE, payment: { payment: 1 }, target: { network_id: NETWORK, expected_generation: 3 } });
  assert.equal(requests[0].headers["idempotency-key"], KEY);
  assert.equal(requests[0].headers["x-quote-token"], "quote-test");
  await call("find_network_product_order", { quote_id: RESOURCE });
  assert.equal(requests[1].path, `/account/networking/product-orders?quote_id=${RESOURCE}`);
});

test("renewal uses same quote/key/token and API-key auto-renew only exposes off", async t => {
  const { call, requests } = await harness(t);
  await call("quote_public_address_renewal", { address_id: RESOURCE, idempotencyKey: KEY });
  await call("renew_network_public_address", { address_id: RESOURCE, quote_id: NETWORK, quoteToken: "quote-test", idempotencyKey: KEY, acknowledge_charge: true });
  await call("disable_public_address_auto_renew", { address_id: RESOURCE });
  assert.equal(requests[0].headers["idempotency-key"], requests[1].headers["idempotency-key"]);
  assert.deepEqual(requests[1].body, { quote_id: NETWORK });
  assert.deepEqual(requests[2].body, { state: false });
  assert.equal((await call("disable_public_address_auto_renew", { address_id: RESOURCE, state: true })).isError, true);
  assert.equal(requests.length, 3);
});

test("public address target shapes cannot accidentally be combined or moved via path parameters", async t => {
  const { call, requests } = await harness(t);
  await call("attach_public_address_to_network", { address_id: RESOURCE, network_id: NETWORK, expected_generation: 2 });
  await call("attach_public_address_to_server", { address_id: RESOURCE, private_port_id: NETWORK });
  assert.deepEqual(requests[0].body, { network_id: NETWORK, expected_generation: 2 });
  assert.deepEqual(requests[1].body, { private_port_id: NETWORK });
  assert.equal((await call("attach_public_address_to_server", { address_id: RESOURCE, private_port_id: NETWORK, network_id: NETWORK })).isError, true);
  assert.equal(requests.length, 2);
});

test("API refusals remain typed MCP errors and preserve recovery/field information", async t => {
  const { call, requests } = await harness(t, () => ({ status: 403, body: { success: false, reason_code: "networking_scope_required", field: "scopes" } }));
  const result = await call("list_private_networks");
  assert.equal(result.isError, true);
  assert.equal(payload(result).reason_code, "networking_scope_required");
  assert.equal(payload(result).field, "scopes");
  assert.equal(requests.length, 1);
});

test("one-time sealed configuration is explicit, never decrypted and never auto-retried", async t => {
  const sealed = { ephemeral_public_key: "public-key", nonce: "nonce", ciphertext: "sealed-ciphertext" };
  const { call, requests } = await harness(t, () => ({ status: 200, body: { sealed } }));
  assert.equal((await call("take_network_vpn_peer_config", { gateway_id: NETWORK, peer_id: RESOURCE })).isError, true);
  assert.equal(requests.length, 0);
  const result = await call("take_network_vpn_peer_config", { gateway_id: NETWORK, peer_id: RESOURCE, acknowledge_one_time_pickup: true });
  assert.deepEqual(payload(result), { sealed });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].body, undefined);
});

test("gateway uncertainty on one-time GET is not described as a safely retryable read", async t => {
  const { call, requests } = await harness(t, () => ({ status: 502, body: "<html>Bad Gateway</html>" }));
  const result = await call("take_network_vpn_peer_config", { gateway_id: NETWORK, peer_id: RESOURCE, acknowledge_one_time_pickup: true });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /outcome is unknown/);
  assert.doesNotMatch(result.content[0].text, /read-only request can be retried/);
  assert.equal(requests.length, 1);
});

test("every pinned customer SDN route has a typed tool or a documented common-checkout replacement", async () => {
  process.env.VPSNET_API_KEY = "contract-test-key";
  const { networkingTools } = await import("../build/networking-tools.js");
  const fixture = JSON.parse(readFileSync("test/fixtures/networking-routes-20261008.json", "utf8"));
  const operation = r => `${r.method.toUpperCase()} ${r.path.replace(/\{[^}]+\}/g, "{}")}`;
  const registered = new Set(networkingTools.filter(t => t.path.startsWith("/account/networking")).map(operation));
  const excluded = new Set(fixture.excluded.map(operation));
  const routed = new Set(fixture.routes.map(operation));
  assert.equal(fixture.routes.length, 92);
  for (const route of routed) assert.ok(registered.has(route) || excluded.has(route), route);
  for (const route of registered) assert.ok(routed.has(route), route);
  for (const route of excluded) assert.ok(!registered.has(route), `excluded legacy route must not become a bypass: ${route}`);
  assert.ok(fixture.excluded.every(r => r.reason.length > 0));
  assert.equal(networkingTools.length, new Set(networkingTools.map(t => t.name)).size);
});

test("network create DNS records use service while subsequent name aliases use name", async t => {
  const { call, requests } = await harness(t);
  await call("create_private_network", { name: "office", subnet: { cidr: "172.16.0.0/24" }, settings: { dns_records: [{ service: "db", ipv4: "172.16.0.10" }], dns_zone: "office", dns_mode: "provider" }, idempotencyKey: KEY });
  assert.deepEqual(requests[0].body.settings.dns_records, [{ service: "db", ipv4: "172.16.0.10" }]);
  await call("set_private_network_names", { network_id: NETWORK, zone_label: "office", aliases: [{ name: "db", ipv4: "172.16.0.10" }] });
  assert.deepEqual(requests[1].body.aliases, [{ name: "db", ipv4: "172.16.0.10" }]);
});

test("full-tunnel device permits an empty server-grant list without accepting private key fields", async t => {
  const { call, requests } = await harness(t);
  const args = { gateway_id: NETWORK, name: "laptop", grants: [], reveal_public_key: Buffer.alloc(32, 7).toString("base64"), idempotencyKey: KEY };
  await call("create_network_vpn_peer", args);
  assert.deepEqual(requests[0].body.grants, []);
  assert.equal((await call("create_network_vpn_peer", { ...args, reveal_private_key: "private" })).isError, true);
  assert.equal(requests.length, 1);
});


test("paid-operation and spend-cap refusals stop at the quote and remain MCP errors", async t => {
  const cases = [
    { status: 403, body: { success: false, paidOperationsDisabled: true } },
    { status: 403, body: { success: false, paidScopeRequired: true } },
    { status: 402, body: { success: false, dailySpendLimitExceeded: true } },
  ];
  for (const refusal of cases) {
    await t.test(JSON.stringify(refusal.body), async t => {
      const { call, requests } = await harness(t, () => refusal);
      const result = await call("quote_network_product", { network_id: NETWORK, kind: "private_lb", tier: "nlb", idempotencyKey: KEY });
      assert.equal(result.isError, true);
      for (const [field, value] of Object.entries(refusal.body)) assert.equal(payload(result)[field], value);
      assert.equal(requests.length, 1);
      assert.ok(requests[0].path.endsWith("/product-quotes"));
    });
  }
});
