import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

function sample(schema, key) {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.anyOf) return sample(schema.anyOf[0], key);
  if (schema.type === "boolean") return true;
  if (schema.type === "integer" || schema.type === "number") return Math.max(schema.minimum || 1, 1);
  if (schema.type === "array") return Array.from({ length: schema.minItems || 0 }, () => sample(schema.items, key));
  if (schema.type === "object") {
    return Object.fromEntries((schema.required || []).map((field) => [field, sample(schema.properties[field], field)]));
  }
  if (key === "orderNo") return "VP1";
  if (schema.format === "uuid" || /_id$/.test(key)) return UUID;
  if (/idempotency/i.test(key)) return "mock-contract-key-0001";
  if (/Url$/.test(key)) return "";
  if (key === "ip") return "198.51.100.1";
  if (key === "hostname") return "node.example.com";
  return "a".repeat(Math.max(schema.minLength || 6, 6));
}

async function harness(t) {
  const requests = [];
  const api = createServer(async (req, res) => {
    for await (const _chunk of req) { /* Consume the mock-only request body. */ }
    requests.push({ method: req.method, url: req.url });
    res.setHeader("content-type", "application/json");
    res.end('{"success":true,"records":[]}');
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
  });
  const client = new Client({ name: "tool-path-boundary-test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    env: {
      ...process.env,
      VPSNET_API_KEY: "contract-test-key",
      VPSNET_API_URL: `http://127.0.0.1:${api.address().port}`,
    },
  }));
  t.after(async () => client.close());
  return { client, requests, tools: (await client.listTools()).tools };
}

test("every service tool rejects malformed order numbers before HTTP", async (t) => {
  const { client, requests, tools } = await harness(t);
  assert.equal(tools.length, 197);
  const serviceTools = tools.filter((tool) => tool.inputSchema.properties?.orderNo);
  assert.ok(serviceTools.length > 60);
  for (const tool of serviceTools) {
    const args = sample(tool.inputSchema, "root");
    for (const orderNo of [
      "../../account/session", "VP88903/../VP88903", "VP88903/graphs?m=cpu&p=1h",
      "VP88903?x=1", "VP88903#", "VP88903\\start", "%2e%2e", "", "V".repeat(65),
    ]) {
      const before = requests.length;
      const result = await client.callTool({ name: tool.name, arguments: { ...args, orderNo } });
      assert.equal(result.isError, true, `${tool.name}: ${orderNo}`);
      assert.match(result.content[0].text, /orderNo/, tool.name);
      assert.equal(requests.length, before, tool.name);
    }
  }
});

test("other URL segments, numeric IDs and enums reject invalid input before HTTP", async (t) => {
  const { client, requests, tools } = await harness(t);
  const cases = [
    ["get_invoice", "hash", ["../../profile#", ".", "a".repeat(65)]],
    ["rollback_snapshot", "snapname", ["..", ".", "name/rollback", "a".repeat(129)]],
    ["delete_snapshot", "snapname", ["..", "name?x=1"]],
    ["get_function_invocation", "invocation_id", ["..", ".", "a".repeat(65)]],
    ["apply_dns_template", "template", ["..", ".", "web_service/../..", "a".repeat(65)]],
    ["get_service_graphs", "metric", ["cpu&x=1", "unknown"]],
    ["get_service_graphs", "period", ["unknown"]],
    ["get_service_graphs", "fields", [["unknown"], ["rx"], ["a".repeat(33)], Array(11).fill("ior")]],
    ["get_order_plans", "type", ["../../account/session", "vps_storage"]],
    ["get_pricing", "type", ["../../account/session", "vps_storage"]],
    ["check_domain_availability", "domain", ["a".repeat(254)]],
  ];
  for (const [name, field, values] of cases) {
    const tool = tools.find((tool) => tool.name === name);
    for (const value of values) {
      const before = requests.length;
      const result = await client.callTool({ name, arguments: { ...sample(tool.inputSchema, "root"), [field]: value } });
      assert.equal(result.isError, true, `${name}: ${field}`);
      assert.equal(requests.length, before, `${name}: ${field}`);
    }
  }
  const routeIds = new Set(["id", "plan", "domain_id", "record_id", "zone_id", "snapshot_id", "function_id", "token_id", "page"]);
  for (const tool of tools) {
    for (const [field, schema] of Object.entries(tool.inputSchema.properties || {})) {
      if (!routeIds.has(field) || !["integer", "number"].includes(schema.type)) continue;
      for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 1e20]) {
        const before = requests.length;
        const result = await client.callTool({ name: tool.name, arguments: { ...sample(tool.inputSchema, "root"), [field]: value } });
        assert.equal(result.isError, true, `${tool.name}: ${field}=${value}`);
        assert.equal(requests.length, before, `${tool.name}: ${field}=${value}`);
      }
    }
  }
});

test("valid service formats and supported route segments retain their intended URLs", async (t) => {
  const { client, requests } = await harness(t);
  for (const orderNo of ["VP88903", "vp88903", "VD12345", "DS12345", "VP88903-1"]) {
    const result = await client.callTool({ name: "get_service", arguments: { orderNo } });
    assert.notEqual(result.isError, true);
    assert.deepEqual(requests.at(-1), { method: "GET", url: `/account/services/${orderNo}` });
  }
  await client.callTool({ name: "change_title", arguments: { orderNo: "VP88903-1", title: "mock-title" } });
  assert.deepEqual(requests.at(-1), { method: "POST", url: "/account/services/VP88903-1/change-title" });
  await client.callTool({ name: "create_snapshot", arguments: { orderNo: "VD12345" } });
  assert.deepEqual(requests.at(-1), { method: "POST", url: "/account/services/VD12345/snapshots" });
  await client.callTool({ name: "get_invoice", arguments: { hash: "a".repeat(64) } });
  assert.equal(requests.at(-1).url, `/account/history/invoices/${"a".repeat(64)}`);
  await client.callTool({ name: "get_function_invocation", arguments: { function_id: 1, invocation_id: "ab12-34" } });
  assert.equal(requests.at(-1).url, "/account/firecracker/functions/1/invocations/ab12-34");
  await client.callTool({ name: "apply_dns_template", arguments: { zone_id: 1, template: "web_service", preview: true } });
  assert.equal(requests.at(-1).url, "/account/dns/zones/1/templates/web_service");
});
