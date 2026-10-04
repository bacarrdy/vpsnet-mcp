import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const EVENT = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";

/**
 * Actual stdio SDK/schema/handler/HTTP serialization against a local API fixture.
 * Producer contract: backend OsController::store/dedicatedStore and
 * acceptedSnapshotDeletion. No provider, guest or external API is called.
 */
async function harness(t, { pendingSnapshot = false } = {}) {
  const requests = [];
  const accepted = [];
  const api = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    requests.push({ method: req.method, path: req.url, body });
    res.setHeader("content-type", "application/json");
    const dedicated = req.url.includes("/DS12345/");
    const snapshotDeletion = {
      service_type: "firecracker", active_count: 1,
      pending_count: pendingSnapshot ? 1 : 0, will_delete: true,
    };
    const error = (status, code, extra = {}) => {
      res.statusCode = status;
      res.end(JSON.stringify({ success: false, [code]: true, ...extra }));
    };
    if (req.method === "GET") {
      return res.end(JSON.stringify({ success: true, os: [], snapshotDeletion,
        ...(dedicated ? { dedicated: true, confirmRequired: true } : {}) }));
    }
    if (dedicated) {
      if (body.rootPassword) return error(422, "baremetalRootPasswordNotSupported");
      if (body.confirmReinstall !== true) return error(422, "baremetalReinstallConfirmationRequired");
      accepted.push(body);
      res.statusCode = 202;
      return res.end(JSON.stringify({ success: true, reinstall: JOB }));
    }
    if (pendingSnapshot) return error(409, "snapshotActionInProgress", { snapshotDeletion });
    if (body.confirmSnapshotDelete !== true) return error(409, "snapshotsWillBeDeleted", { snapshotDeletion });
    accepted.push(body);
    res.end(JSON.stringify({ success: true, noty: EVENT }));
  });
  await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    api.closeAllConnections();
    await new Promise(resolve => api.close(resolve));
  });
  const client = new Client({ name: "reinstall-contract-test", version: "1.0.0" });
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

test("reinstall metadata distinguishes acceptance responses and requires explicit snapshot consent", async t => {
  const { client, requests } = await harness(t);
  const tool = (await client.listTools()).tools.find(tool => tool.name === "reinstall_os");
  assert.match(tool.description, /dedicated acceptance returns a reinstall job ID in the reinstall field/);
  assert.match(tool.description, /VPS acceptance returns a noty UUID/);
  assert.match(tool.description, /cannot provide rollback after reinstall/);
  assert.doesNotMatch(tool.description, /take one first|DELETE it once the reinstall succeeds|system disk will be erased/);
  assert.match(tool.description, /everything on all server disks will be erased/);
  assert.deepEqual(tool.inputSchema.required, ["orderNo", "osVersion"]);
  for (const field of ["confirmDataLoss", "confirmSnapshotDelete"]) {
    assert.equal(tool.inputSchema.properties[field].type, "boolean");
    assert.equal(tool.inputSchema.properties[field].default, undefined);
  }
  assert.match(tool.inputSchema.properties.confirmSnapshotDelete.description, /only after the user explicitly confirms/);
  assert.equal(requests.length, 0);
});

test("get_os_options exposes the producer snapshot summary without a mutation", async t => {
  const { client, accepted, requests } = await harness(t);
  const result = await client.callTool({ name: "get_os_options", arguments: { orderNo: "VP12345" } });
  assert.equal(JSON.parse(result.content[0].text).snapshotDeletion.active_count, 1);
  assert.equal(requests[0].method, "GET");
  assert.equal(accepted.length, 0);
});

test("existing snapshots refuse omitted or false consent without automatically retrying or confirming", async t => {
  const { call, requests, accepted } = await harness(t);
  for (const args of [{}, { confirmSnapshotDelete: false }, { confirmDataLoss: true }]) {
    const before = requests.length;
    const result = await call(args);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /snapshotsWillBeDeleted/);
    assert.equal(requests.length, before + 1);
    assert.equal(requests.at(-1).body.confirmSnapshotDelete, undefined);
  }
  assert.equal(accepted.length, 0);
});

test("explicit snapshot consent reaches the exact producer field and preserves the VPS event", async t => {
  const { call, requests, accepted } = await harness(t);
  const result = await call({ confirmSnapshotDelete: true });
  assert.notEqual(result.isError, true);
  assert.deepEqual(requests[0], { method: "POST", path: "/account/services/VP12345/change-os",
    body: { osVersion: 2, confirmSnapshotDelete: true } });
  assert.deepEqual(JSON.parse(result.content[0].text), { success: true, noty: EVENT });
  assert.equal(accepted.length, 1);
});

test("snapshot consent never bypasses a pending snapshot action", async t => {
  const { call, accepted } = await harness(t, { pendingSnapshot: true });
  const result = await call({ confirmSnapshotDelete: true });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /snapshotActionInProgress/);
  assert.equal(accepted.length, 0);
});

test("neither boolean confirmation is coerced from strings, numbers, null or objects", async t => {
  const { call, requests } = await harness(t);
  for (const field of ["confirmSnapshotDelete", "confirmDataLoss"]) {
    for (const value of ["true", 1, 0, null, {}]) {
      assert.equal((await call({ [field]: value })).isError, true);
    }
  }
  assert.equal(requests.length, 0);
});

test("dedicated data-loss consent remains independent of snapshot consent and arbitrary backend fields", async t => {
  const { call, requests, accepted } = await harness(t);
  for (const args of [{}, { confirmDataLoss: false }, { confirmSnapshotDelete: true }, { confirmReinstall: true }]) {
    const result = await call({ orderNo: "DS12345", ...args });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /baremetalReinstallConfirmationRequired/);
    assert.equal(requests.at(-1).body.confirmReinstall, undefined);
  }
  assert.equal(accepted.length, 0);
});

test("dedicated 202 response stays a reinstall job, with explicit confirmation and optional SSH key", async t => {
  const { call, requests, accepted } = await harness(t);
  const result = await call({ orderNo: "DS12345", confirmDataLoss: true, sshKeyId: 17 });
  assert.notEqual(result.isError, true);
  assert.deepEqual(requests[0].body, { osVersion: 2, sshKey: 17, confirmReinstall: true });
  assert.deepEqual(JSON.parse(result.content[0].text), { success: true, reinstall: JOB });
  await call({ orderNo: "DS12345", confirmDataLoss: true });
  assert.deepEqual(requests[1].body, { osVersion: 2, confirmReinstall: true });
  assert.equal(accepted.length, 2);
});

test("dedicated root-password refusal remains an actionable tool error", async t => {
  const { call, accepted } = await harness(t);
  const result = await call({ orderNo: "DS12345", confirmDataLoss: true, rootPassword: "Synthetic123" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /baremetalRootPasswordNotSupported/);
  assert.equal(accepted.length, 0);
});
