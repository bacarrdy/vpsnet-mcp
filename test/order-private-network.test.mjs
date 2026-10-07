import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const NETWORK = "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
const IDEMPOTENCY = "order-private-network-0001";
const PAYMENT = { payment: 1, successUrl: "", cancelUrl: "" };

// The real SDK, schema, tool handler and HTTP transport run against a local
// fixture of OrderController::quote/confirm; no external API is touched.
async function harness(t, { quoteRefusal = null } = {}) {
  const requests = [];
  const api = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    requests.push({ method: req.method, path: req.url, body, quoteToken: req.headers["x-quote-token"] });
    res.setHeader("content-type", "application/json");
    if (req.url === "/order/configuration/quote") {
      if (quoteRefusal !== null) {
        res.statusCode = 422;
        return res.end(JSON.stringify({ success: false, [quoteRefusal]: true }));
      }
      return res.end(JSON.stringify({ success: true, amount_eur: 5, quoteToken: "quote-1" }));
    }
    res.end(JSON.stringify({ success: true, orderNo: "VP12345" }));
  });
  await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    api.closeAllConnections();
    await new Promise(resolve => api.close(resolve));
  });
  const client = new Client({ name: "order-private-network-test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    env: {
      PATH: process.env.PATH,
      VPSNET_API_KEY: "contract-test-key",
      VPSNET_API_URL: `http://127.0.0.1:${api.address().port}`,
    },
  }));
  t.after(() => client.close());
  const call = args => client.callTool({ name: "order_service", arguments: {
    plan: 7, os: 3, period: 1, resources: [901], idempotencyKey: IDEMPOTENCY, payment: PAYMENT, ...args,
  } });
  return { client, call, requests };
}

test("order_service advertises an optional private network UUID and no new tool", async t => {
  const { client, requests } = await harness(t);
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 197);
  const tool = tools.find(tool => tool.name === "order_service");
  const field = tool.inputSchema.properties.privateNetworkId;
  assert.equal(field.type, "string");
  assert.ok(field.pattern, "the UUID shape is part of the advertised schema");
  assert.match(field.description, /private network/i);
  assert.ok(!tool.inputSchema.required.includes("privateNetworkId"));
  assert.match(tool.description, /privateNetworkId/);
  assert.equal(requests.length, 0);
});

test("a selected private network reaches the quote and the confirm unchanged", async t => {
  const { call, requests } = await harness(t);
  const result = await call({ privateNetworkId: NETWORK });
  assert.notEqual(result.isError, true);
  assert.equal(requests.length, 2);
  const [quote, confirm] = requests;
  assert.equal(quote.path, "/order/configuration/quote");
  assert.equal(confirm.path, "/order/configuration/confirm");
  assert.equal(quote.body.privateNetworkId, NETWORK);
  assert.equal(confirm.body.privateNetworkId, NETWORK);
  assert.equal(confirm.quoteToken, "quote-1");
  // Everything the quote priced is what the confirm submits, plus the token.
  const { quoteToken, ...confirmed } = confirm.body;
  assert.equal(quoteToken, "quote-1");
  assert.deepEqual(confirmed, quote.body);
});

test("an order without a private network sends no privateNetworkId at all", async t => {
  const { call, requests } = await harness(t);
  const result = await call({});
  assert.notEqual(result.isError, true);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(Object.hasOwn(request.body, "privateNetworkId"), false);
  }
});

test("a malformed private network id is refused before any HTTP call", async t => {
  const { call, requests } = await harness(t);
  for (const privateNetworkId of ["", "net-1", "3f2a9c1e5b7d4e8f9a0b1c2d3e4f5a6b", 42, null, {}, [NETWORK]]) {
    const result = await call({ privateNetworkId });
    assert.equal(result.isError, true, `refused: ${JSON.stringify(privateNetworkId)}`);
  }
  assert.equal(requests.length, 0);
});

test("a backend refusal of the network stops before confirm and is shown as an error", async t => {
  const { call, requests } = await harness(t, { quoteRefusal: "network_attachment_unavailable" });
  const result = await call({ privateNetworkId: NETWORK });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /network_attachment_unavailable/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/order/configuration/quote");
});
