import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP marks API failures across ordinary and projected tools without retrying", async (t) => {
  const requests = [];
  const api = createServer((req, res) => {
    requests.push({ method: req.method, path: req.url });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/account/session") {
      res.end('{"error":"404 - Page Not Found."}');
    } else if (req.url === "/account/profile") {
      res.end('{"success":false,"validate":"error","_errors":{"f":["regex"]}}');
    } else if (req.url === "/account/services") {
      res.end('{"success":false,"notFound":true}');
    } else if (req.url === "/account/ssh-keys/1") {
      res.statusCode = 403;
      res.end('{"success":false,"apiKeyScopeMissing":true,"requiredScope":"services:manage"}');
    } else if (req.url === "/account/events/1") {
      res.end('{"state":"error","payload":null,"message":"Action failed"}');
    } else if (req.url === "/order/configuration/quote") {
      res.statusCode = 403;
      res.end('{"success":false,"apiKeyPaidOperationsDisabled":true,"requiredScope":"fc:order"}');
    } else if (req.url === "/account/services/VP1/backup/status") {
      res.end('{"status":false,"price":9.99}');
    } else {
      res.statusCode = 422;
      res.end('{"success":false,"notFound":true,"private_key":"must-not-leak"}');
    }
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
  });

  const client = new Client({ name: "tool-error-test", version: "1.0.0" });
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
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 197, "Error handling preserves every registered tool");

  for (const [name, args, projected] of [
    ["get_account", {}, false],
    ["get_profile", {}, false],
    ["list_services", {}, false],
    ["delete_ssh_key", { id: 1 }, false],
    ["get_event", { id: 1 }, false],
    ["wait_for_event", { id: 1, timeout_seconds: 5 }, false],
    ["get_service_rescue", { orderNo: "VP1" }, true],
    ["list_certificates", {}, true],
    ["list_restore_file_points", { orderNo: "VP1" }, true],
    ["list_temp_vms", {}, true],
    ["order_service", { plan: 1, idempotencyKey: "mock-order-quote-0001", payment: { payment: 1, successUrl: "", cancelUrl: "" } }, false],
  ]) {
    const before = requests.length;
    const response = await client.callTool({ name, arguments: args });
    assert.equal(response.isError, true, name);
    assert.equal(requests.length, before + 1, `${name} sends exactly one request`);
    const payload = JSON.parse(response.content[0].text);
    if (name === "order_service") {
      assert.equal(payload.apiKeyPaidOperationsDisabled, true);
      assert.equal(payload.requiredScope, "fc:order");
      assert.equal(requests.at(-1).path, "/order/configuration/quote");
    }
    if (projected) {
      assert.equal(payload.success, false, name);
      assert.doesNotMatch(response.content[0].text, /must-not-leak|private_key/,
        `${name} applies its existing projection before error marking`);
    }
    if (name === "delete_ssh_key") {
      assert.equal(payload.http_status, 403);
      assert.equal(payload.auth_problem.code, "apiKeyScopeMissing");
    }
    if (name === "wait_for_event") {
      assert.equal(payload.state, "error");
      assert.equal(payload.timed_out, false);
    }
  }

  const backup = await client.callTool({ name: "get_backup_status", arguments: { orderNo: "VP1" } });
  assert.equal(backup.isError, undefined);
  assert.deepEqual(JSON.parse(backup.content[0].text), { status: false, price: 9.99 });
});
