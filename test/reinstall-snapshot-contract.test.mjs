import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const EVENT = "11111111-1111-4111-8111-111111111111";

// The actual SDK, schema, tool handler and HTTP transport run against a local
// fixture of OsController::store; no external API or service is touched.
async function harness(t, { snapshots = 1, pending = false } = {}) {
  const requests = [];
  const accepted = [];
  const api = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    requests.push({ method: req.method, path: req.url, body });
    res.setHeader("content-type", "application/json");
    const snapshotDeletion = { service_type: "firecracker", active_count: snapshots,
      pending_count: pending ? 1 : 0, will_delete: snapshots > 0 };
    if (req.method === "GET") {
      return res.end(JSON.stringify({ success: true, os: [], snapshotDeletion }));
    }
    if (pending || (snapshots > 0 && body.confirmSnapshotDelete !== true)) {
      res.statusCode = 409;
      return res.end(JSON.stringify({ success: false, snapshotDeletion,
        [pending ? "snapshotActionInProgress" : "snapshotsWillBeDeleted"]: true }));
    }
    accepted.push(body);
    res.end(JSON.stringify({ success: true, noty: EVENT }));
  });
  await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    api.closeAllConnections();
    await new Promise(resolve => api.close(resolve));
  });
  const client = new Client({ name: "reinstall-snapshot-contract-test", version: "1.0.0" });
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
  const call = args => client.callTool({ name: "reinstall_os", arguments: {
    orderNo: "VP12345", osVersion: 2, ...args,
  } });
  return { client, call, requests, accepted };
}

test("advertised snapshot consent is optional and never defaulted; no dedicated feature is introduced", async t => {
  const { client, requests } = await harness(t);
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 197);
  const tool = tools.find(tool => tool.name === "reinstall_os");
  assert.match(tool.description, /cannot provide rollback after reinstall/);
  assert.doesNotMatch(tool.description, /take one first|DELETE it once the reinstall succeeds/);
  assert.match(tool.description, /Returns a noty UUID/);
  assert.deepEqual(tool.inputSchema.required, ["orderNo", "osVersion"]);
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(),
    ["orderNo", "osVersion", "rootPassword", "confirmSnapshotDelete"].sort());
  assert.equal(tool.inputSchema.properties.confirmSnapshotDelete.type, "boolean");
  assert.equal(tool.inputSchema.properties.confirmSnapshotDelete.default, undefined);
  assert.match(tool.inputSchema.properties.confirmSnapshotDelete.description, /only after the user explicitly confirms/);
  assert.equal(requests.length, 0);
});

test("get_os_options exposes the snapshot summary without accepting a mutation", async t => {
  const { client, requests, accepted } = await harness(t);
  const result = await client.callTool({ name: "get_os_options", arguments: { orderNo: "VP12345" } });
  assert.equal(JSON.parse(result.content[0].text).snapshotDeletion.active_count, 1);
  assert.equal(requests[0].method, "GET");
  assert.equal(accepted.length, 0);
});

test("omitted or false snapshot consent stays absent and refusals are never automatically retried", async t => {
  const { call, requests, accepted } = await harness(t);
  for (const args of [{}, { confirmSnapshotDelete: false }, { confirmDataLoss: true }]) {
    const before = requests.length;
    const result = await call(args);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /snapshotsWillBeDeleted/);
    assert.deepEqual(requests.at(-1).body, { osVersion: 2 });
    assert.equal(requests.length, before + 1);
  }
  assert.equal(accepted.length, 0);
});

test("explicit true reaches the exact backend field and retains the acceptance event", async t => {
  const { call, requests, accepted } = await harness(t);
  const result = await call({ confirmSnapshotDelete: true });
  assert.notEqual(result.isError, true);
  assert.deepEqual(requests[0], { method: "POST", path: "/account/services/VP12345/change-os",
    body: { osVersion: 2, confirmSnapshotDelete: true } });
  assert.deepEqual(JSON.parse(result.content[0].text), { success: true, noty: EVENT });
  assert.equal(accepted.length, 1);
});

test("snapshot consent does not bypass an in-progress snapshot action", async t => {
  const { call, accepted } = await harness(t, { pending: true });
  const result = await call({ confirmSnapshotDelete: true });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /snapshotActionInProgress/);
  assert.equal(accepted.length, 0);
});

test("malformed confirmation is rejected before HTTP instead of coerced", async t => {
  const { call, requests } = await harness(t);
  for (const confirmSnapshotDelete of ["true", "false", 1, 0, null, {}, []]) {
    assert.equal((await call({ confirmSnapshotDelete })).isError, true);
  }
  assert.equal(requests.length, 0);
});

test("a server without snapshots still accepts reinstall without the new field", async t => {
  const { call, requests, accepted } = await harness(t, { snapshots: 0 });
  const result = await call({ rootPassword: "Synthetic123" });
  assert.notEqual(result.isError, true);
  assert.deepEqual(requests[0].body, { osVersion: 2, rootPassword: "Synthetic123" });
  assert.equal(accepted.length, 1);
});
