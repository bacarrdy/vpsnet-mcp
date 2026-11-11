import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

process.env.VPSNET_API_KEY ||= "vpsnet_" + "x".repeat(43);
const { appCloudTools, scrubSecrets, isNotAvailable } = await import("../build/app-cloud-tools.js");
const spec = JSON.parse((await import("node:fs")).readFileSync(new URL("./fixtures/app-cloud-openapi-routes.json", import.meta.url), "utf8"));

const tool = name => { const found = appCloudTools.find(t => t.name === name); assert.ok(found, name); return found; };
const json = res => JSON.parse(res.content[0].text);
const RECEIPT = "R".repeat(43);
const DIGEST = "ghcr.io/acme/shop@sha256:" + "a".repeat(64);

/** Recording deps: answers come from `answer(call)`; defaults to 200 {success:true}. */
function mock(answer = () => ({ status: 200, data: { success: true } })) {
  const calls = [];
  const deps = {
    request: async (method, path, body, headers, semantics) => { const call = { kind: "api", method, path, body, headers, semantics }; calls.push(call); return answer(call); },
    rawRequest: async (method, path, bytes, headers) => { const call = { kind: "raw", method, path, bytes: Buffer.from(bytes), headers }; calls.push(call); return answer(call); },
    receipt: () => RECEIPT,
  };
  return { deps, calls };
}

const disabled = { status: 404, data: { success: false, app_cloud_disabled: true, error_detail: { code: "app_cloud_disabled" }, http_status: 404 } };

// One valid call per tool: the route, scope and body it must match in the published API description.
const samples = {
  get_app_cloud_availability: {},
  get_app_cloud_options: {},
  check_app_cloud_project_name: { name: "shop" },
  list_app_cloud_projects: {},
  get_app_cloud_project: { project_id: 7 },
  create_app_cloud_project: { name: "qa-shop", plan_id: 132, instance_count: 2, source_kind: "image", image: DIGEST, health_path: "/up", port: 3000, auto_deploy: false, env: [{ name: "MODE", value: "x", kind: "plain" }], confirmed: true, acknowledge_hourly_billing: true },
  connect_app_cloud_git_source: { project_id: 7, provider: "github", repository: "acme/shop", branch: "main", root: "app", installation_id: 5, confirmed: true },
  list_app_cloud_github_installations: {},
  deploy_app_cloud_git_source: { project_id: 7, commit_sha: "b".repeat(40), confirmed: true },
  deploy_app_cloud_project: { project_id: 7, image: DIGEST, confirmed: true },
  list_app_cloud_deployments: { project_id: 7 },
  get_app_cloud_build_log: { project_id: 7, deployment_id: 11 },
  get_app_cloud_logs: { project_id: 7, lines: 50, instance: "1", since: "2026-11-11T10:00:00Z" },
  rollback_app_cloud_project: { project_id: 7, deployment_id: 11, confirmed: true },
  list_app_cloud_env: { project_id: 7 },
  set_app_cloud_env: { project_id: 7, variables: [{ name: "TOKEN", value: "s3cret-value", kind: "secret" }], confirmed: true },
  stop_app_cloud_project: { project_id: 7, confirmed: true },
  start_app_cloud_project: { project_id: 7, confirmed: true, acknowledge_hourly_billing: true },
  delete_app_cloud_project: { project_id: 7, confirm_name: "qa-shop", acknowledge_data_loss: true, confirmed: true },
  get_app_cloud_database_options: {},
  list_app_cloud_databases: {},
  create_app_cloud_database: { name: "qa-db", engine: "pg", topology: "single", plan_id: 3, project_id: 7, env_name: "DATABASE_URL", confirmed: true, acknowledge_hourly_billing: true },
  attach_app_cloud_database: { database_id: 9, project_id: 7, env_name: "DB_URL", confirmed: true },
  reveal_app_cloud_database_credentials: { database_id: 9, confirmed: true },
  acknowledge_app_cloud_database_credentials: { database_id: 9, receipt: RECEIPT },
};
// upload_app_cloud_source is covered against a real file below.

const template = path => path.split("?")[0].replace(/\/(\d+)(?=\/|$)/g, "/{id}").replace(/\/actions\/[a-z]+$/, "/actions/{id}").replace(/\/[a-f0-9]{32}(?=\/|$)/g, "/{uploadId}");
const specRoute = (method, path) => spec.routes.find(r => r.method === method && r.path.replace(/\{(?!id\}|uploadId\})[^}]+\}/g, "{id}") === template(path));

test("every tool is a registered, strict, correctly annotated App Cloud tool with the scopes the API enforces", () => {
  assert.deepEqual(appCloudTools.map(t => t.name).sort(), [...Object.keys(samples), "upload_app_cloud_source"].sort());
  assert.equal(new Set(appCloudTools.map(t => t.name)).size, appCloudTools.length);
  for (const t of appCloudTools) {
    assert.match(t.description, /Managed Applications/, `${t.name} says it is not the catalogue`);
    assert.match(t.description, /app_cloud_not_available/, `${t.name} says what an off product answers`);
    assert.ok(t.scopes.length > 0 && t.scopes.every(s => /^(projects|projectdb):(read|manage)$/.test(s)), t.name);
    assert.match(t.description, new RegExp(t.scopes[0]), `${t.name} names its scope`);
    assert.ok(!(t.annotations.readOnlyHint && t.annotations.destructiveHint), t.name);
    assert.equal(t.readOnly, t.scopes.every(s => s.endsWith(":read")), `${t.name}: read scope iff read-only`);
    assert.throws(() => t.schema.parse({ ...(samples[t.name] ?? { project_id: 7, local_path: "/tmp/a.zip", confirmed: true }), unexpected: 1 }), undefined, `${t.name} is strict`);
    if (!t.readOnly) assert.equal(t.schema.shape.confirmed !== undefined || t.name.startsWith("acknowledge_"), true, `${t.name} asks for confirmation`);
  }
  for (const name of ["delete_app_cloud_project", "rollback_app_cloud_project", "stop_app_cloud_project"]) assert.equal(tool(name).annotations.destructiveHint, true, name);
  for (const name of ["create_app_cloud_project", "create_app_cloud_database", "start_app_cloud_project"]) {
    assert.match(tool(name).description, /per hour|hourly/i, name);
    assert.ok(tool(name).schema.shape.acknowledge_hourly_billing, name);
    assert.equal(tool(name).paid, "Usage-billed hourly", name);
  }
  assert.equal(tool("attach_app_cloud_database").scopes.join(), "projectdb:manage,projects:manage");
});

test("each call matches a published route: method, path, scope, body fields and query", async () => {
  for (const [name, args] of Object.entries(samples)) {
    const t = tool(name);
    const { deps, calls } = mock();
    const parsed = t.schema.parse(args);
    const res = await t.run(parsed, deps);
    assert.equal(res.isError, undefined, name);
    const call = calls.find(c => c.kind === "api");
    assert.ok(call, name);
    assert.equal(call.headers === undefined || Object.keys(call.headers).length === 0 || name === "none", true, `${name} sends no extra headers (the API has no idempotency key here)`);
    const route = specRoute(call.method, call.path);
    assert.ok(route, `${name}: ${call.method} ${call.path} is not a published route`);
    assert.ok(route.scopes.includes(t.scopes[0]), `${name}: scope ${t.scopes[0]} vs ${route.scopes}`);
    if (t.readOnly) { assert.ok(route.access.includes("read"), name); assert.equal(call.semantics?.readOnly, true, name); }
    else assert.equal(route.access, "full", name);
    for (const key of Object.keys(call.body ?? {})) assert.ok(route.body?.includes(key), `${name}: body field ${key} is not in the route's request body`);
    for (const key of new URLSearchParams(call.path.split("?")[1] ?? "").keys()) assert.ok(route.query.includes(key), `${name}: query ${key}`);
  }
});

test("exact requests of the main flows", async () => {
  let m = mock();
  await tool("create_app_cloud_project").run(tool("create_app_cloud_project").schema.parse(samples.create_app_cloud_project), m.deps);
  assert.deepEqual(m.calls[0].body, { name: "qa-shop", plan_id: 132, source: { kind: "image", image: DIGEST }, instance_count: 2, health_path: "/up", port: 3000, auto_deploy: false, env: [{ name: "MODE", value: "x", kind: "plain" }] });
  m = mock();
  await tool("create_app_cloud_project").run({ name: "qa-shop", plan_id: 1, confirmed: true, acknowledge_hourly_billing: true }, m.deps);
  assert.deepEqual(m.calls[0].body, { name: "qa-shop", plan_id: 1, source: { kind: "image" } });
  m = mock();
  await tool("delete_app_cloud_project").run(samples.delete_app_cloud_project, m.deps);
  assert.deepEqual([m.calls[0].method, m.calls[0].path, m.calls[0].body], ["DELETE", "/account/projects/7", { confirm_name: "qa-shop" }]);
  m = mock();
  await tool("create_app_cloud_database").run(tool("create_app_cloud_database").schema.parse(samples.create_app_cloud_database), m.deps);
  assert.deepEqual(m.calls[0].body, { name: "qa-db", engine: "pg", topology: "single", plan_id: 3, env_name: "DATABASE_URL", app_id: 7 });
  m = mock();
  await tool("attach_app_cloud_database").run(samples.attach_app_cloud_database, m.deps);
  assert.deepEqual([m.calls[0].path, m.calls[0].body], ["/account/project-databases/9/bindings", { app_id: 7, env_name: "DB_URL" }]);
  m = mock();
  await tool("rollback_app_cloud_project").run(samples.rollback_app_cloud_project, m.deps);
  assert.equal(m.calls[0].path, "/account/projects/7/deploys/11/rollback");
  m = mock();
  await tool("stop_app_cloud_project").run(samples.stop_app_cloud_project, m.deps);
  assert.equal(m.calls[0].path, "/account/projects/7/actions/stop");
  m = mock();
  await tool("get_app_cloud_logs").run(samples.get_app_cloud_logs, m.deps);
  assert.equal(m.calls[0].path, "/account/projects/7/logs?lines=50&instance=1&since=2026-11-11T10%3A00%3A00Z");
});

test("paid and destructive calls are refused without the explicit acknowledgements", () => {
  const create = tool("create_app_cloud_project").schema;
  const base = { name: "qa-shop", plan_id: 1 };
  assert.throws(() => create.parse(base));
  assert.throws(() => create.parse({ ...base, confirmed: true }));
  assert.throws(() => create.parse({ ...base, acknowledge_hourly_billing: true }));
  assert.throws(() => create.parse({ ...base, confirmed: true, acknowledge_hourly_billing: "yes" }));
  assert.throws(() => create.parse({ ...base, name: "Shop", confirmed: true, acknowledge_hourly_billing: true }), undefined, "uppercase name");
  assert.throws(() => create.parse({ ...base, image: "ghcr.io/acme/shop:latest", confirmed: true, acknowledge_hourly_billing: true }), undefined, "tag without digest");
  const del = tool("delete_app_cloud_project").schema;
  assert.throws(() => del.parse({ project_id: 7, confirm_name: "qa-shop", confirmed: true }), undefined, "data loss not acknowledged");
  assert.throws(() => del.parse({ project_id: 7, confirm_name: "qa-shop", acknowledge_data_loss: true }));
  assert.throws(() => del.parse({ project_id: 7, acknowledge_data_loss: true, confirmed: true }), undefined, "name required");
  assert.throws(() => tool("create_app_cloud_database").schema.parse({ name: "qa-db", engine: "oracle", confirmed: true, acknowledge_hourly_billing: true }));
  assert.throws(() => tool("set_app_cloud_env").schema.parse({ project_id: 7, variables: [{ name: "PORT", value: "1" }], confirmed: true }), undefined, "PORT reserved");
  assert.throws(() => tool("set_app_cloud_env").schema.parse({ project_id: 7, variables: [{ name: "VPSNET_X", value: "1" }], confirmed: true }), undefined, "VPSNET_ reserved");
  assert.throws(() => tool("get_app_cloud_project").schema.parse({ project_id: "7/../x" }));
});

test("create refuses an image together with another source kind before any request", async () => {
  const { deps, calls } = mock();
  const res = await tool("create_app_cloud_project").run({ name: "qa-shop", plan_id: 1, source_kind: "git", image: DIGEST, confirmed: true, acknowledge_hourly_billing: true }, deps);
  assert.equal(res.isError, true);
  assert.equal(calls.length, 0);
});

test("while App Cloud is off every tool answers app_cloud_not_available: clear, not a crash, nothing changed", async () => {
  for (const [name, args] of Object.entries(samples)) {
    if (name === "get_app_cloud_availability") continue;
    const { deps } = mock(() => disabled);
    const res = await tool(name).run(tool(name).schema.parse(args), deps);
    assert.equal(res.isError, true, name);
    const body = json(res);
    assert.equal(body.reason_code, "app_cloud_not_available", name);
    assert.equal(body.available, false);
    assert.equal(body.changed, false);
    assert.match(body.message, /not available on this account yet/);
    assert.match(body.message, /Nothing was created, changed or charged/);
  }
  // A route the API does not know at all (an older API) reads the same way; a project that does not exist does not.
  const old = mock(() => ({ status: 404, data: { success: false, non_api_response: true, http_status: 404, error: "HTTP 404 from api.vpsnet.com: no such route." } }));
  assert.equal(json(await tool("list_app_cloud_projects").run({}, old.deps)).reason_code, "app_cloud_not_available");
  const missing = mock(() => ({ status: 404, data: { success: false, project_not_found: true, http_status: 404 } }));
  const notFound = await tool("get_app_cloud_project").run({ project_id: 99 }, missing.deps);
  assert.equal(notFound.isError, true);
  assert.equal(json(notFound).reason_code, undefined);
  assert.equal(isNotAvailable({ status: 404, data: { project_not_found: true } }), false);
  assert.equal(isNotAvailable({ status: 403, data: { app_cloud_disabled: true } }), false);
});

test("the availability tool answers either way and says what enabled=false means", async () => {
  const off = await tool("get_app_cloud_availability").run({}, mock(() => ({ status: 200, data: { success: true, enabled: false } })).deps);
  assert.equal(off.isError, undefined);
  assert.equal(json(off).enabled, false);
  assert.match(off.content[1].text, /not available on this account yet/);
  const on = await tool("get_app_cloud_availability").run({}, mock(() => ({ status: 200, data: { success: true, enabled: true } })).deps);
  assert.equal(on.content.length, 1);
});

test("a key without the explicit grant, and unpaid usage, get a reason the assistant can relay", async () => {
  const scope = await tool("list_app_cloud_projects").run({}, mock(() => ({ status: 403, data: { success: false, apiKeyScopeMissing: true, requiredScope: "projects:read", error_detail: { code: "apiKeyScopeMissing", requiredScope: "projects:read" } } })).deps);
  assert.equal(scope.isError, true);
  assert.equal(json(scope).requiredScope, "projects:read");
  assert.match(scope.content[1].text, /explicit grants/);
  const pay = await tool("create_app_cloud_project").run({ name: "qa-shop", plan_id: 1, confirmed: true, acknowledge_hourly_billing: true }, mock(() => ({ status: 402, data: { success: false, payment_method_required: true } })).deps);
  assert.equal(pay.isError, true);
  assert.match(pay.content[1].text, /balance or a saved card/);
});

test("no secret leaves through a read: secret variables and credential keys are scrubbed", async () => {
  const env = await tool("list_app_cloud_env").run({ project_id: 7 }, mock(() => ({ status: 200, data: { success: true, variables: [
    { name: "A", kind: "plain", value: "visible" }, { name: "B", kind: "secret", value: "leaked-secret" },
    { name: "DATABASE_URL", kind: "secret", value: null, source: "database" }], connection_string: "postgresql://u:p@h/db" } })).deps);
  const text = env.content[0].text;
  assert.doesNotMatch(text, /leaked-secret|postgresql:\/\/u:p/);
  assert.match(text, /visible/);
  assert.deepEqual(scrubSecrets({ a: { password: "x", token_set: true, token: "t" } }), { a: { password: "[not shown]", token_set: true, token: "[not shown]" } });
  const set = await tool("set_app_cloud_env").run(samples.set_app_cloud_env, mock(() => ({ status: 200, data: { success: true, variables: [{ name: "TOKEN", kind: "secret", value: "s3cret-value" }] } })).deps);
  assert.doesNotMatch(set.content[0].text, /s3cret-value/);
});

test("reveal-once: the receipt is generated and returned, the password is shown, a repeat uses the same receipt", async () => {
  const creds = { success: true, credentials: { generation: 1, username: "app", password: "pw-once", connection_string: "postgresql://app:pw-once@10.0.0.1:5432/app", expires_at: "2026-11-11 12:00:00" } };
  let m = mock(() => ({ status: 200, data: creds }));
  const first = await tool("reveal_app_cloud_database_credentials").run({ database_id: 9, confirmed: true }, m.deps);
  assert.deepEqual([m.calls[0].method, m.calls[0].path, m.calls[0].body], ["POST", "/account/project-databases/9/credentials/reveal", { receipt: RECEIPT }]);
  assert.match(first.content[0].text, /pw-once/);
  assert.match(first.content[1].text, new RegExp(`receipt=${RECEIPT}`));
  m = mock(() => ({ status: 200, data: creds }));
  await tool("reveal_app_cloud_database_credentials").run({ database_id: 9, receipt: "S".repeat(43), confirmed: true }, m.deps);
  assert.equal(m.calls[0].body.receipt, "S".repeat(43));
  const closed = await tool("reveal_app_cloud_database_credentials").run({ database_id: 9, confirmed: true }, mock(() => ({ status: 410, data: { success: false, reveal_closed: true, http_status: 410 } })).deps);
  assert.equal(closed.isError, true);
  assert.match(closed.content[1].text, /Only a password reset/);
  assert.doesNotMatch(closed.content.map(c => c.text).join(""), /receipt=/);
  assert.throws(() => tool("reveal_app_cloud_database_credentials").schema.parse({ database_id: 9, receipt: "short", confirmed: true }));
  assert.match(tool("reveal_app_cloud_database_credentials").description, /ONCE, in clear/);
  // The list answer never carries a password even if the API sent one.
  const list = await tool("list_app_cloud_databases").run({}, mock(() => ({ status: 200, data: { success: true, databases: [{ id: 9, name: "qa-db", password: "x", connection_string: "postgresql://a:b@c/d" }] } })).deps);
  assert.doesNotMatch(list.content[0].text, /postgresql:|"x"/);
});

test("Git source: github and gitlab need repository and branch, vpsnet takes none, secrets of the creating answer are shown once", async () => {
  const connect = tool("connect_app_cloud_git_source");
  let m = mock();
  assert.equal((await connect.run({ project_id: 7, provider: "github", repository: "acme/shop", confirmed: true }, m.deps)).isError, true);
  assert.equal((await connect.run({ project_id: 7, provider: "vpsnet", repository: "acme/shop", confirmed: true }, m.deps)).isError, true);
  assert.equal(m.calls.length, 0);
  assert.throws(() => connect.schema.parse({ project_id: 7, provider: "github", repository: "a/b", branch: "main", token: "ghp_x", confirmed: true }), undefined, "a token never passes through the assistant");
  m = mock(() => ({ status: 200, data: { success: true, git: { provider: "vpsnet", push: { url: "https://api.example/git/7", token: "push-token-once" }, webhook: null } } }));
  const res = await connect.run({ project_id: 7, provider: "vpsnet", confirmed: true }, m.deps);
  assert.deepEqual([m.calls[0].method, m.calls[0].path, m.calls[0].body], ["PUT", "/account/projects/7/sources/git", { provider: "vpsnet" }]);
  assert.match(res.content[0].text, /push-token-once/);
  assert.match(res.content[1].text, /shown only now/);
  const later = await tool("list_app_cloud_github_installations").run({}, mock(() => ({ status: 200, data: { success: true, installations: [], token: "x" } })).deps);
  assert.doesNotMatch(later.content[0].text, /"x"/);
});

test("upload_app_cloud_source: hash, chunk in order with the documented headers, complete; a failed chunk aborts the upload", async () => {
  const dir = mkdtempSync(join(tmpdir(), "appcloud-w6-"));
  try {
    const bytes = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz"); // 36 bytes, chunk size 16 -> 16, 16, 4
    const file = join(dir, "shop.tar.gz");
    writeFileSync(file, bytes);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const id = "c".repeat(32);
    const base = `/account/projects/7/sources/upload/${id}`;
    const answer = fail => call => {
      if (call.method === "POST" && call.path === "/account/projects/7/sources/upload") return { status: 201, data: { success: true, upload: { id, state: "uploading", size: 36, received: 0, chunk_size: 16, transfer: { method: "PUT", auth: "session", url: `${base}/chunk` } } } };
      if (call.kind === "raw") {
        if (fail && call.headers["Content-Range"].startsWith("bytes 16-")) return { status: 422, data: { success: false, upload_chunk_invalid: true, http_status: 422 } };
        const end = Number(call.headers["Content-Range"].match(/-(\d+)\//)[1]) + 1;
        return { status: 200, data: { success: true, received: end, complete: end === 36 } };
      }
      if (call.method === "POST" && call.path === `${base}/complete`) return { status: 200, data: { success: true, upload: { id, state: "checking" }, deployment: { id: 21, state: "pending" } } };
      if (call.method === "DELETE") return { status: 200, data: { success: true } };
      throw new Error(`unexpected ${call.method} ${call.path}`);
    };
    let m = mock(answer(false));
    const ok = await tool("upload_app_cloud_source").run({ project_id: 7, local_path: file, message: "from MCP", confirmed: true }, m.deps);
    assert.equal(ok.isError, undefined);
    assert.deepEqual(m.calls[0].body, { filename: "shop.tar.gz", size: 36, sha256: digest });
    const chunks = m.calls.filter(c => c.kind === "raw");
    assert.deepEqual(chunks.map(c => c.headers["Content-Range"]), ["bytes 0-15/36", "bytes 16-31/36", "bytes 32-35/36"]);
    assert.deepEqual(Buffer.concat(chunks.map(c => c.bytes)), bytes);
    for (const c of chunks) assert.equal(c.headers["X-Chunk-Sha256"], createHash("sha256").update(c.bytes).digest("hex"));
    assert.deepEqual(m.calls.at(-1).body, { message: "from MCP" });
    assert.match(ok.content[1].text, new RegExp(digest));

    m = mock(answer(true));
    const bad = await tool("upload_app_cloud_source").run({ project_id: 7, local_path: file, confirmed: true }, m.deps);
    assert.equal(bad.isError, true);
    assert.equal(m.calls.some(c => c.path === `${base}/complete`), false, "nothing is completed after a failed chunk");
    assert.equal(m.calls.at(-1).method, "DELETE");
    assert.match(bad.content.at(-1).text, /Nothing was deployed/);

    m = mock();
    assert.equal((await tool("upload_app_cloud_source").run({ project_id: 7, local_path: join(dir, "x.exe"), confirmed: true }, m.deps)).isError, true);
    assert.equal((await tool("upload_app_cloud_source").run({ project_id: 7, local_path: join(dir, "missing.zip"), confirmed: true }, m.deps)).isError, true);
    assert.equal(m.calls.length, 0);
    assert.throws(() => tool("upload_app_cloud_source").schema.parse({ project_id: 7, local_path: "relative.zip", confirmed: true }));

    m = mock(() => disabled);
    assert.equal(json(await tool("upload_app_cloud_source").run({ project_id: 7, local_path: file, confirmed: true }, m.deps)).reason_code, "app_cloud_not_available");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function harness(t, handler) {
  const requests = [];
  const api = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    const { status, body } = handler(req, requests.at(-1));
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  });
  await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());
  const client = new Client({ name: "app-cloud-tools", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath, args: ["build/index.js"],
    env: { ...process.env, VPSNET_API_KEY: "vpsnet_" + "k".repeat(43), VPSNET_API_URL: `http://127.0.0.1:${api.address().port}` },
  });
  await client.connect(transport);
  t.after(async () => client.close());
  return { client, requests };
}

test("stdio server: the tools are listed with titles and hints, and an off product answers cleanly over the wire", async t => {
  const { client, requests } = await harness(t, req => req.url === "/account/projects/availability"
    ? { status: 200, body: { success: true, enabled: false } }
    : { status: 404, body: { success: false, app_cloud_disabled: true, error_detail: { code: "app_cloud_disabled" } } });
  const { tools } = await client.listTools();
  const byName = new Map(tools.map(x => [x.name, x]));
  for (const t of appCloudTools) {
    const listed = byName.get(t.name);
    assert.ok(listed, `${t.name} is listed`);
    assert.equal(listed.annotations.readOnlyHint, t.annotations.readOnlyHint, t.name);
    assert.equal(listed.annotations.destructiveHint, t.annotations.destructiveHint, t.name);
    assert.ok(listed.annotations.title, t.name);
  }
  const availability = await client.callTool({ name: "get_app_cloud_availability", arguments: {} });
  assert.equal(availability.isError, undefined);
  const list = await client.callTool({ name: "list_app_cloud_projects", arguments: {} });
  assert.equal(list.isError, true);
  assert.equal(JSON.parse(list.content[0].text).reason_code, "app_cloud_not_available");
  const create = await client.callTool({ name: "create_app_cloud_project", arguments: { name: "qa-shop", plan_id: 1, confirmed: true, acknowledge_hourly_billing: true } });
  assert.equal(create.isError, true);
  assert.equal(JSON.parse(create.content[0].text).changed, false);
  const refused = await client.callTool({ name: "delete_app_cloud_project", arguments: { project_id: 7, confirm_name: "qa-shop", confirmed: true } });
  assert.equal(refused.isError, true, "no acknowledge_data_loss: refused before any request");
  assert.equal(requests.some(r => r.method === "DELETE"), false);
  for (const r of requests) assert.equal(r.headers["x-api-key"], "vpsnet_" + "k".repeat(43));
  assert.equal(requests.some(r => /^\/(admin|internal)/.test(r.url)), false);
});

test("the hosted OAuth connector does not offer App Cloud tools (no OAuth scope exists for them)", async () => {
  const { createVpsnetServer } = await import("../build/index.js");
  const server = createVpsnetServer({ remoteScopes: ["services:read", "services:manage", "applications:read", "applications:manage", "networking:read", "networking:manage"] });
  const names = Object.keys(server._registeredTools);
  assert.equal(names.some(name => /app_cloud/.test(name)), false);
});
