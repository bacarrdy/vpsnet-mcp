import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { explainDedicatedReadiness } from "../build/dedicated-readiness.js";

const TOKEN = "q".repeat(48);
const KEY = "ds-order-key-0000001";

/**
 * Real stdio SDK/schema/handler/HTTP serialisation against a local fixture.
 * Producer contract: backend e32994a16 OrderController::quote/confirmPrepared
 * (503 dedicatedPreparationUnavailable + readinessReason before payment),
 * ApiKeyPaidActionGuard (Idempotency-Key 16..190 chars, X-Quote-Token),
 * MainController::applyBareMetalFacts / BareMetalDeliveredFacts::genericProjection.
 */
async function harness(t, reason) {
  const requests = [];
  const api = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    requests.push({ method: req.method, path: req.url, headers: req.headers, body });
    res.setHeader("content-type", "application/json");
    if (req.url === "/order/configuration/quote") {
      return res.end(JSON.stringify({ success: true, amount_eur: 99, quoteToken: TOKEN, quoteExpiresAt: "2026-10-04T12:00:00Z" }));
    }
    if (req.url === "/order/configuration/confirm") {
      res.statusCode = 503;
      return res.end(JSON.stringify({ success: false, dedicatedPreparationUnavailable: true, readinessReason: reason }));
    }
    if (req.url === "/account/services/DS12345") {
      return res.end(JSON.stringify({
        success: true,
        service: { orderNo: "DS12345", ipsSource: "catalogue", osSource: "catalogue", facts: { source: "catalogue", asOrdered: true, observedAt: null } },
      }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    api.closeAllConnections();
    await new Promise(resolve => api.close(resolve));
  });
  const client = new Client({ name: "dedicated-order-test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    env: { PATH: process.env.PATH, VPSNET_API_KEY: "contract-test-key", VPSNET_API_URL: `http://127.0.0.1:${api.address().port}` },
  }));
  t.after(async () => client.close());
  return { client, requests };
}

const order = { plan: 148, os: 5, sshKey: 7, period: 1, resources: [901], payment: { payment: 1, successUrl: "", cancelUrl: "" } };

test("order_service surfaces each typed dedicated readiness reason with words, as an error, after one quote and one confirm", async t => {
  for (const reason of ["customer_network_not_ready", "stock_qualification_missing", "stock_not_available", "order_input_invalid"]) {
    const { client, requests } = await harness(t, reason);
    const result = await client.callTool({ name: "order_service", arguments: { ...order, idempotencyKey: KEY } });
    assert.equal(result.isError, true, reason);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.readinessReason, reason);
    assert.equal(payload.dedicatedPreparationUnavailable, true);
    assert.equal(payload.http_status, 503);
    assert.equal(payload.dedicated_readiness.reason, reason);
    assert.ok(payload.dedicated_readiness.explanation.length > 20, reason);
    assert.match(payload.dedicated_readiness.no_payment_taken, /before payment/);
    assert.deepEqual(requests.map(r => r.path), ["/order/configuration/quote", "/order/configuration/confirm"]);
    const [quote, confirm] = requests;
    assert.equal(quote.headers["idempotency-key"], KEY);
    assert.equal(confirm.headers["idempotency-key"], KEY);
    assert.equal(confirm.headers["x-quote-token"], TOKEN);
    assert.equal(confirm.body.sshKey, 7, "dedicated order sends the SSH key id the backend resolves");
    assert.equal(confirm.body.quoteToken, TOKEN);
  }
});

test("order_service refuses an idempotency key the API would refuse (shorter than 16) before any request", async t => {
  const { client, requests } = await harness(t, "stock_not_available");
  const result = await client.callTool({ name: "order_service", arguments: { ...order, idempotencyKey: "short-key-1234" } });
  assert.equal(result.isError, true);
  assert.equal(requests.length, 0);
});

test("explainDedicatedReadiness names known codes, keeps unknown codes unguessed, leaves other bodies untouched", () => {
  const known = explainDedicatedReadiness({ success: false, dedicatedPreparationUnavailable: true, readinessReason: "customer_network_capability_absent" });
  assert.match(known.dedicated_readiness.explanation, /customer network/);
  const unknown = explainDedicatedReadiness({ dedicatedPreparationUnavailable: true, readinessReason: "something_new" });
  assert.equal(unknown.dedicated_readiness.explanation, null);
  assert.equal(unknown.readinessReason, "something_new");
  const other = { success: true, noty: "x" };
  assert.equal(explainDedicatedReadiness(other), other);
  const noFlag = { readinessReason: "stock_not_available" };
  assert.equal(explainDedicatedReadiness(noFlag), noFlag);
  assert.equal(explainDedicatedReadiness(null), null);
});

test("get_service passes the catalogue-versus-installation source flags through unchanged", async t => {
  const { client } = await harness(t, "stock_not_available");
  const result = await client.callTool({ name: "get_service", arguments: { orderNo: "DS12345" } });
  const service = JSON.parse(result.content[0].text).service;
  assert.equal(service.ipsSource, "catalogue");
  assert.equal(service.facts.asOrdered, true);
  const tools = (await client.listTools()).tools;
  const description = tools.find(tool => tool.name === "get_service").description;
  assert.match(description, /catalogue/);
  assert.match(description, /never present catalogue values as delivered facts/);
  for (const name of ["start_service", "stop_service", "restart_service", "console_service"]) {
    assert.match(tools.find(tool => tool.name === name).description, /dedicated/, name);
  }
  const orderDescription = tools.find(tool => tool.name === "order_service").description;
  assert.match(orderDescription, /ds:order/);
  assert.match(orderDescription, /readinessReason/);
});
