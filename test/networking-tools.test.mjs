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
function followUpReads(result) {
  const hint = result.content.find(item => item.type === "text" && item.text.startsWith("Follow-up reads (do not repeat the change): "));
  return hint ? JSON.parse(hint.text.slice("Follow-up reads (do not repeat the change): ".length)) : [];
}

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
  for (const name of ["set_private_network_names", "set_network_routed_egress", "retry_network_security_policy", "retry_private_network", "retry_private_network_port"]) {
    assert.equal(find(name).annotations.destructiveHint, true, `${name} may remove existing configuration or connectivity`);
  }
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
  await call("list_network_attachment_candidates", { network_id: NETWORK, after: "opaque+/=cursor", service_id: "VP12345" });
  await call("get_networking_topology", { metrics: "current" });
  await call("list_network_products", { network_id: NETWORK });
  assert.deepEqual(requests.map(r => [r.method, r.path]), [
    ["GET", `/account/networking/networks/${NETWORK}`],
    ["GET", `/account/networking/networks/${NETWORK}/attachment-candidates?after=opaque%2B%2F%3Dcursor&service_id=VP12345`],
    ["GET", "/account/networking/topology?metrics=current"],
    ["GET", `/account/networking/products?network_id=${NETWORK}`],
  ]);
  assert.ok(requests.every(r => r.body === undefined));
  assert.ok(requests.every(r => r.headers["x-api-key"] === "contract-test-key"));
});

test("new-order unavailability does not remove existing-server private-network routes", async t => {
  const first = "VP12345";
  const second = "VP12346";
  const candidatePath = `/account/networking/networks/${NETWORK}/attachment-candidates`;
  const { client, call, requests } = await harness(t, request => {
    if (request.path === "/account/networking/capabilities") return { status: 200, body: {
      private_network: { available: false, reason_code: "network_attachment_unavailable" },
      order_availability: { available: false, reason_code: "network_attachment_unavailable" },
    } };
    if (request.method === "GET" && request.path === "/account/networking/networks") return { status: 200, body: { networks: [] } };
    if (request.method === "POST" && request.path === "/account/networking/networks") return { status: 202, body: { network: { id: NETWORK, generation: 1, applied_generation: 0, port_intent_ready: false }, operation: { id: RESOURCE, state: "queued" } } };
    if (request.path === `/account/networking/operations/${RESOURCE}`) return { status: 200, body: { operation: { id: RESOURCE, state: "succeeded", reason_code: "network_graph_created" } } };
    if (request.path === `/account/networking/networks/${NETWORK}`) return { status: 200, body: { network: { id: NETWORK, provisioning_status: "configured", generation: 1, applied_generation: 0, health_reason_code: "network_graph_created", port_intent_ready: true } } };
    if (request.path === `${candidatePath}?service_id=${first}`) return { status: 200, body: { candidates: [], candidates_has_more: true, next_cursor: "next/1" } };
    if (request.path === `${candidatePath}?after=next%2F1&service_id=${first}`) return { status: 200, body: { candidates: [{ service_id: first, eligible: true, attachment_mode: "online" }], candidates_has_more: false, next_cursor: null } };
    if (request.path === `${candidatePath}?service_id=${second}`) return { status: 200, body: { candidates: [{ service_id: second, eligible: true, attachment_mode: "restart_required" }], candidates_has_more: false, next_cursor: null } };
    if (request.method === "POST" && request.path === `/account/networking/networks/${NETWORK}/ports`) return { status: 202, body: { accepted: true, operation_id: RESOURCE } };
    if (request.path === `/account/networking/networks/${NETWORK}/ports`) return { status: 200, body: { ports: [{ service_id: first, state: "attached" }, { service_id: second, state: "attached" }] } };
    return { status: 404, body: { success: false, reason_code: "unexpected_test_route" } };
  });

  const tools = new Map((await client.listTools()).tools.map(tool => [tool.name, tool]));
  for (const name of ["create_private_network", "list_network_attachment_candidates", "attach_private_network_port"]) assert.ok(tools.has(name));
  assert.match(tools.get("get_networking_capabilities").description, /order_availability.*existing/i);
  assert.match(tools.get("attach_private_network_port").description, /list_network_attachment_candidates/);

  const capabilities = payload(await call("get_networking_capabilities"));
  assert.equal(capabilities.private_network.available, false);
  assert.equal(payload(await call("list_private_networks")).networks.length, 0);
  assert.notEqual((await call("create_private_network", { name: "internal", idempotencyKey: KEY })).isError, true);
  assert.equal(payload(await call("get_networking_operation", { operation_id: RESOURCE })).operation.state, "succeeded");
  const configured = await call("get_private_network", { network_id: NETWORK });
  assert.equal(payload(configured).network.port_intent_ready, true);
  assert.equal(payload(configured).network.applied_generation, 0);
  const reads = followUpReads(configured);
  assert.deepEqual(reads, [{ tool: "list_network_attachment_candidates", arguments: { network_id: NETWORK } }]);

  const page = payload(await call("list_network_attachment_candidates", { network_id: NETWORK, service_id: first }));
  assert.equal(page.candidates_has_more, true);
  const firstCandidate = payload(await call("list_network_attachment_candidates", { network_id: NETWORK, service_id: first, after: page.next_cursor })).candidates[0];
  const secondCandidate = payload(await call("list_network_attachment_candidates", { network_id: NETWORK, service_id: second })).candidates[0];
  assert.equal(firstCandidate.eligible, true);
  assert.equal(secondCandidate.attachment_mode, "restart_required");
  await call("attach_private_network_port", { network_id: NETWORK, service_id: first, idempotencyKey: "attach-first-0001" });
  await call("attach_private_network_port", { network_id: NETWORK, service_id: second, restart: true, idempotencyKey: "attach-second-0001" });
  const ports = payload(await call("list_private_network_ports", { network_id: NETWORK })).ports;
  assert.deepEqual(ports.map(port => port.state), ["attached", "attached"]);
  assert.deepEqual(requests.map(request => [request.method, request.path]), [
    ["GET", "/account/networking/capabilities"],
    ["GET", "/account/networking/networks"],
    ["POST", "/account/networking/networks"],
    ["GET", `/account/networking/operations/${RESOURCE}`],
    ["GET", `/account/networking/networks/${NETWORK}`],
    ["GET", `${candidatePath}?service_id=${first}`],
    ["GET", `${candidatePath}?after=next%2F1&service_id=${first}`],
    ["GET", `${candidatePath}?service_id=${second}`],
    ["POST", `/account/networking/networks/${NETWORK}/ports`],
    ["POST", `/account/networking/networks/${NETWORK}/ports`],
    ["GET", `/account/networking/networks/${NETWORK}/ports`],
  ]);
  const attachments = requests.filter(request => request.method === "POST" && request.path.endsWith("/ports"));
  assert.deepEqual(attachments.map(request => request.body), [{ service_id: first }, { service_id: second, restart: true }]);
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
  await call("attach_private_network_port", { network_id: NETWORK, service_id: "VP12345", ipv4: "172.16.0.10", restart: true, idempotencyKey: KEY });
  await call("retry_private_network_port", { network_id: NETWORK, port_id: RESOURCE, expected_generation: 4, restart: true, idempotencyKey: KEY });
  assert.deepEqual(requests[0].body, { service_id: "VP12345", ipv4: "172.16.0.10", restart: true });
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

test("paid inventory wait and operator review remain exact read results with no new payment or retry", async t => {
  let response = { success: true, order_id: RESOURCE, quote_id: NETWORK, paymentid: 123,
    status: "paid_pending", billing_state: "captured", reason_code: "network_product_ip_inventory_wait",
    payment_total: "18.15", currency: "EUR" };
  const { client, call, requests } = await harness(t, () => ({ status: 200, body: response }));
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 311);
  assert.match(tools.find(t => t.name === "get_network_product_order").description, /network_product_ip_inventory_wait/);
  assert.match(tools.find(t => t.name === "get_network_product_order").description, /operator review/);
  for (const update of [
    {},
    { status: "manual_review", reason_code: "network_product_stock_reconciliation_required" },
    { status: "fulfilled", reason_code: null, resource_id: NETWORK, attachment: { status: "pending", reason_code: null } },
  ]) {
    response = { ...response, ...update };
    const result = await call("get_network_product_order", { order_id: RESOURCE });
    assert.notEqual(result.isError, true, "a readable order state is not an HTTP/tool failure");
    assert.deepEqual(payload(result), response);
  }
  assert.deepEqual(requests.map(r => [r.method, r.path]), Array(3).fill(["GET", `/account/networking/product-orders/${RESOURCE}`]));
});

test("service process wait and attention survive MCP unchanged without provisioning actions", async t => {
  let process = { title: "Creating server", percentage: 0, waitingReason: "public_ip_inventory" };
  const { client, call, requests } = await harness(t, () => ({ status: 200, body: {
    orderno: "VP12345", stateProcess: process, stateProccess: process,
  } }));
  const tools = (await client.listTools()).tools;
  for (const name of ["get_service", "order_service"]) {
    assert.match(tools.find(t => t.name === name).description, /public_ip_inventory/);
    assert.match(tools.find(t => t.name === name).description, /operator attention/);
  }
  for (const next of [process, { title: "Creating server", percentage: 0, attention: true }]) {
    process = next;
    const result = await call("get_service", { orderNo: "VP12345" });
    assert.notEqual(result.isError, true);
    assert.deepEqual(payload(result).stateProcess, process);
    assert.deepEqual(payload(result).stateProccess, process);
  }
  assert.deepEqual(requests.map(r => [r.method, r.path]), Array(2).fill(["GET", "/account/services/VP12345"]));
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
  await call("create_private_network", { name: "office", subnet: { cidr: "100.64.0.0/26" }, settings: { dns_records: [{ service: "db", ipv4: "100.64.0.10" }], dns_zone: "office", dns_mode: "provider" }, idempotencyKey: KEY });
  assert.deepEqual(requests[0].body.settings.dns_records, [{ service: "db", ipv4: "100.64.0.10" }]);
  await call("set_private_network_names", { network_id: NETWORK, zone_label: "office", aliases: [{ name: "db", ipv4: "100.64.0.10" }] });
  assert.deepEqual(requests[1].body.aliases, [{ name: "db", ipv4: "100.64.0.10" }]);
});

test("network create sends the chosen subnet size and only platform-pool subnets of /28 to /24", async t => {
  const { call, requests } = await harness(t);
  await call("create_private_network", { name: "sized", subnet_prefix_length: 24, idempotencyKey: KEY });
  assert.deepEqual(requests[0].body, { name: "sized", subnet_prefix_length: 24 });
  for (const bad of [{ subnet_prefix_length: 23 }, { subnet_prefix_length: "26" }, { subnet: { cidr: "172.16.0.0/24" } }, { subnet: { cidr: "100.128.0.0/24" } }, { subnet: { cidr: "100.64.0.0/16" } }]) {
    assert.equal((await call("create_private_network", { name: "bad", ...bad, idempotencyKey: KEY })).isError, true, JSON.stringify(bad));
  }
  assert.equal(requests.length, 1);
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
    { status: 403, body: { success: false, apiKeyPaidOperationsDisabled: true, requiredScope: "networking:order" } },
    { status: 403, body: { success: false, apiKeyPaidScopeMissing: true, requiredScope: "networking:order" } },
    { status: 403, body: { success: false, apiKeyDailySpendCapExceeded: true } },
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


test("security-policy and public-binding receipts route follow-up reads to their own resources", async t => {
  const project = "b22093d5-985a-443c-9a93-e0dcf6609d84";
  const securityPath = `/account/networking/projects/${project}/networks/${NETWORK}/security-policy`;
  const { call, requests } = await harness(t, request => {
    if (request.method === "PUT") return { status: 200, body: { group: { id: RESOURCE }, policies: [{ id: RESOURCE, network_id: NETWORK, generation: 2, state: "pending" }] } };
    if (request.path === securityPath) return { status: 200, body: { network_id: NETWORK, project_id: project, generation: 2, applied_generation: 1, state: "pending" } };
    if (request.method === "POST") return { status: 202, body: { resource_id: RESOURCE, generation: 2, state: "awaiting_preparation", operation: { id: NETWORK, action: "bind" } } };
    if (request.path === `/account/networking/public-bindings/${RESOURCE}`) return { status: 200, body: { id: RESOURCE, generation: 2, state: "prepared" } };
    return { status: 404, body: { reason_code: "wrong_operation_store" } };
  });
  const group = await call("update_network_security_group", { project_id: project, group_id: RESOURCE, name: "restricted", rules: [], expected_revision: 1, idempotencyKey: KEY });
  assert.equal(payload(group).policies[0].state, "pending");
  assert.deepEqual(followUpReads(group), [{ tool: "get_network_security_policy", arguments: { project_id: project, network_id: NETWORK } }]);
  for (const read of followUpReads(group)) assert.equal(payload(await call(read.tool, read.arguments)).state, "pending");
  const binding = await call("bind_network_public_ip", { binding_id: RESOURCE, private_port_id: NETWORK, expected_generation: 1, idempotencyKey: KEY });
  assert.deepEqual(followUpReads(binding), [{ tool: "get_network_public_binding", arguments: { binding_id: RESOURCE } }]);
  for (const read of followUpReads(binding)) assert.equal(payload(await call(read.tool, read.arguments)).state, "prepared");
  assert.deepEqual(requests.map(request => [request.method, request.path]), [
    ["PUT", `/account/networking/projects/${project}/security-groups/${RESOURCE}`],
    ["GET", securityPath],
    ["POST", `/account/networking/public-bindings/${RESOURCE}/bind`],
    ["GET", `/account/networking/public-bindings/${RESOURCE}`],
  ]);
  assert.ok(requests.every(request => !request.path.includes("/operations/")));
});

test("saved VPN setting, DNS changes and address changes keep their separate readiness reads", async t => {
  const { call, requests } = await harness(t, request => {
    if (request.path.endsWith("/server-access")) return { status: 200, body: { operation: { id: RESOURCE, state: "succeeded" }, vpn_gateway: { id: RESOURCE, network_id: NETWORK } } };
    if (request.path.endsWith("/dns")) return { status: 202, body: { network: { id: NETWORK, settings: { dns_change: { id: RESOURCE, state: "pending" } } } } };
    if (request.path.endsWith("/attach")) return { status: 200, body: { public_address: { id: RESOURCE, status: "attaching" } } };
    return { status: 200, body: { accepted: true } };
  });
  const vpn = await call("set_vpn_server_access", { gateway_id: RESOURCE, mode: "accept", idempotencyKey: KEY });
  assert.deepEqual(followUpReads(vpn), [
    { tool: "get_network_appliance_operation", arguments: { operation_id: RESOURCE } },
    { tool: "get_private_network", arguments: { network_id: NETWORK } },
  ]);
  const dns = await call("set_private_network_dns", { network_id: NETWORK, dns_mode: "none", idempotencyKey: KEY });
  assert.deepEqual(followUpReads(dns), [{ tool: "get_private_network", arguments: { network_id: NETWORK } }]);
  const address = await call("attach_public_address_to_network", { address_id: RESOURCE, network_id: NETWORK, expected_generation: 1 });
  assert.deepEqual(followUpReads(address), [
    { tool: "get_network_public_address", arguments: { address_id: RESOURCE } },
    { tool: "get_network_routed_egress", arguments: { network_id: NETWORK } },
  ]);
  assert.equal(requests.length, 3, "follow-up hints never automatically execute another request");
});

test("refusals and unready networks do not advertise first-attachment reads", async t => {
  const { call, requests } = await harness(t, request => request.method === "GET"
    ? { status: 200, body: { network: { id: NETWORK, generation: 1, applied_generation: 0, port_intent_ready: false } } }
    : { status: 409, body: { reason_code: "network_parent_not_applied" } });
  assert.deepEqual(followUpReads(await call("get_private_network", { network_id: NETWORK })), []);
  const refusal = await call("attach_private_network_port", { network_id: NETWORK, service_id: "VP12345", idempotencyKey: KEY });
  assert.equal(refusal.isError, true);
  assert.equal(payload(refusal).reason_code, "network_parent_not_applied");
  assert.deepEqual(followUpReads(refusal), []);
  assert.equal(requests.length, 2);
});
