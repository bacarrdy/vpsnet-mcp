import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP distinguishes lost mutation responses from GET and reviewed POST reads", async (t) => {
  const requests = [];
  let appliedMutations = 0;
  const api = createServer(async (req, res) => {
    for await (const _chunk of req) { /* The upstream consumed the request. */ }
    requests.push({ method: req.method, path: req.url });
    if (req.url === "/account/services/VP1/change-title" || req.method === "DELETE") {
      appliedMutations += 1;
    }
    // Simulate an operation applied upstream before the gateway lost its answer.
    res.writeHead(502, { "Content-Type": "text/html" });
    res.end("<html>Bad Gateway</html>");
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
  });
  const client = new Client({ name: "gateway-outcome-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    env: {
      ...process.env,
      VPSNET_API_KEY: "contract-test-key",
      VPSNET_API_URL: `http://127.0.0.1:${api.address().port}`,
    },
  });
  await client.connect(transport);
  t.after(async () => client.close());
  async function call(name, args) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true);
    return JSON.parse(result.content[0].text);
  }

  for (const [name, args] of [
    ["list_services", {}],
    ["calculate_plan_change", { orderNo: "VP1", plan: 1, resources: [1] }],
  ]) {
    const result = await call(name, args);
    assert.equal(result.retry_guidance, "retry_read");
    assert.equal(result.outcome_unknown, false);
    assert.match(result.error, /read-only request can be retried/);
  }

  for (const [name, args] of [
    ["change_title", { orderNo: "VP1", title: "test-title" }],
    ["delete_ssh_key", { id: 1 }],
  ]) {
    const result = await call(name, args);
    assert.equal(result.http_status, 502);
    assert.equal(result.outcome_unknown, true);
    assert.equal(result.retry_guidance, "inspect_state_before_retry");
    assert.match(result.error, /Do not automatically repeat/);
    assert.match(result.error, /current resource state or any returned event\/status/);
    assert.match(result.error, /original key and unchanged payload/);
    assert.doesNotMatch(result.error, /retry after a short pause|Nothing is known to have changed/);
  }
  assert.equal(appliedMutations, 2);
  assert.deepEqual(requests, [
    { method: "GET", path: "/account/services" },
    { method: "POST", path: "/account/services/VP1/plans-options/calculate" },
    { method: "POST", path: "/account/services/VP1/change-title" },
    { method: "DELETE", path: "/account/ssh-keys/1" },
  ]);
});

test("all gateway status variants preserve uncertain PUT/PATCH/POST/DELETE outcomes", async (t) => {
  const received = [];
  const api = createServer(async (req, res) => {
    for await (const _chunk of req) { /* No unconsumed body. */ }
    received.push(req.method);
    const code = Number(req.url.split("/").at(-1));
    res.writeHead(code, { "Content-Type": "text/html" });
    res.end(req.url.startsWith("/empty/") ? "" : "<html>Upstream response lost</html>");
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
  });
  const previous = { key: process.env.VPSNET_API_KEY, url: process.env.VPSNET_API_URL };
  process.env.VPSNET_API_KEY = "contract-test-key";
  process.env.VPSNET_API_URL = `http://127.0.0.1:${api.address().port}`;
  t.after(() => {
    for (const [name, value] of [["VPSNET_API_KEY", previous.key], ["VPSNET_API_URL", previous.url]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const { apiRequest, describeNonApiResponse } = await import("../build/api.js");
  for (const status of [502, 503, 504]) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const result = await apiRequest(method, `/${status}`, { operation: "test" });
      assert.equal(result.status, status);
      assert.equal(result.data.outcome_unknown, true);
      assert.equal(result.data.retry_guidance, "inspect_state_before_retry");
    }
    const empty = await apiRequest("POST", `/empty/${status}`, { operation: "test" });
    assert.equal(empty.data.outcome_unknown, true, "A lost empty response is also uncertain");
    assert.equal(empty.data.body_excerpt, undefined);
  }
  assert.equal(received.length, 15, "No gateway failure resubmits the request");
  assert.equal(describeNonApiResponse(504, "text/html", "", "test.invalid").outcome_unknown, true,
    "A caller without reviewed read semantics must default to uncertain");
  assert.equal(describeNonApiResponse(403, "text/html", "denied", "test.invalid").outcome_unknown,
    undefined, "Non-gateway refusal retains its own error contract");
});
