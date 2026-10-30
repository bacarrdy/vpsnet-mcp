import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createVpsnetServer } from "../build/index.js";

// Customer source contract: backend 779254fe25961acd2f3360770756647f5d689def,
// PublicNetworkProductController / PublicAddressController. Synthetic transport
// proves request compatibility, not live term offers, payment or provisioning.
const NETWORK = "2f186a34-88a3-49fc-93e8-71931b212867";
const RESOURCE = "a22093d5-985a-443c-9a93-e0dcf6609d84";
const KEY = "network-term-test-0001";
const PREFIX = "/account/networking";
const cases = [
  ["quote_network_product", { network_id: NETWORK, kind: "vpn_gateway", tier: "wireguard" }, `${PREFIX}/networks/${NETWORK}/product-quotes`, { kind: "vpn_gateway", tier: "wireguard", prepare_after_payment: true }],
  ["quote_account_vpn", { tier: "wireguard", network_id: NETWORK }, `${PREFIX}/vpn/product-quotes`, { tier: "wireguard", network_id: NETWORK, prepare_after_payment: true }],
  ["quote_network_product_renewal", { network_id: NETWORK, resource_id: RESOURCE }, `${PREFIX}/networks/${NETWORK}/product-periods/${RESOURCE}/quote`, {}],
  ["quote_vpn_period_renewal", { gateway_id: RESOURCE }, `${PREFIX}/appliances/vpn-gateways/${RESOURCE}/period/quote`, {}],
  ["quote_network_public_address", { network_id: NETWORK }, `${PREFIX}/public-addresses/quote`, { network_id: NETWORK, prepare_after_payment: true }],
  ["quote_public_address_renewal", { address_id: RESOURCE }, `${PREFIX}/public-addresses/${RESOURCE}/renewal-quote`, {}],
];

test("all six quote tools send the selected term and preserve old omitted-term bodies", async t => {
  const requests = [];
  const api = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ method: req.method, path: req.url, key: req.headers["idempotency-key"], body });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ quote_id: RESOURCE, period_months: body.period_months ?? 1, gross_amount: "12.10" }));
  });
  await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
  t.after(async () => { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); });
  const client = new Client({ name: "network-period-contract", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["build/index.js"],
    env: { PATH: process.env.PATH, VPSNET_API_KEY: "synthetic-term-test-key", VPSNET_API_URL: `http://127.0.0.1:${api.address().port}` } }));
  t.after(() => client.close());
  for (const [name, args, path, body] of cases) {
    const result = await client.callTool({ name, arguments: { ...args, period_months: 12, idempotencyKey: KEY } });
    assert.notEqual(result.isError, true, name);
    assert.deepEqual(requests.at(-1), { method: "POST", path, key: KEY, body: { ...body, period_months: 12 } }, name);
    assert.equal(JSON.parse(result.content[0].text).period_months, 12);
    assert.equal(JSON.parse(result.content[0].text).gross_amount, "12.10");
    await client.callTool({ name, arguments: { ...args, idempotencyKey: KEY + "-old" } });
    assert.deepEqual(requests.at(-1).body, body, `${name}: do not inject defaults into old intent`);
    const before = requests.length;
    for (const period_months of [0, 121, 1.5, "12"]) {
      assert.equal((await client.callTool({ name, arguments: { ...args, period_months, idempotencyKey: KEY } })).isError, true);
    }
    assert.equal(requests.length, before, `${name}: invalid term never reaches API`);
  }
  const tools = (await client.listTools()).tools;
  for (const name of ["order_network_product", "renew_network_product", "renew_vpn_period", "renew_network_public_address"]) {
    assert.equal(tools.find(tool => tool.name === name).inputSchema.properties.period_months, undefined,
      `${name}: confirmation keeps its immutable quote, not a separately editable term`);
  }
});

test("hosted profiles expose the recipe read and keep paid networking quotes excluded", async () => {
  for (const profile of ["directory", "orders"]) {
    const server = createVpsnetServer({ remoteProfile: profile,
      remoteScopes: ["services:read", "networking:read", "networking:manage", "orders:servers", "orders:domains"] });
    const client = new Client({ name: "network-period-hosted", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = (await client.listTools()).tools;
      for (const [name] of cases) assert.equal(tools.some(tool => tool.name === name), false, `${profile}: ${name}`);
      const recipe = tools.find(tool => tool.name === "get_network_vpn_peer_recipe");
      assert.ok(recipe, profile);
      assert.equal(recipe.annotations.readOnlyHint, true);
      assert.deepEqual(recipe._meta.securitySchemes[0].scopes, ["networking:read"]);
    } finally {
      await client.close();
      await server.close();
    }
  }
});
