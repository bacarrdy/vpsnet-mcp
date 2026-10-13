import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { installRemotePolicy } from "../build/remote-policy.js";
import { safeApplicationDataRestorePointsPayload } from "../build/application-contract.js";
import { safeCustomProjectValidationPayload } from "../build/custom-project-contract.js";

const INSTALLATION = "b7ea0c2a-e6e4-4c25-87ca-c0cdf7e4ca42";
const OPERATION = "1f3502fc-1177-4e3f-b867-b3f6d7b9846e";
const OTHER = "935d7a11-e755-4da6-9194-2c065a2b69ce";
const COMPOSE = "services:\n  web:\n    image: docker.io/library/nginx@sha256:" + "a".repeat(64);
const DIGEST = createHash("sha256").update(COMPOSE).digest("hex");
const base = { orderNo: "VP12345", installation_id: INSTALLATION };

async function connect(t, respond) {
  const requests = [];
  const api = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const request = { method: req.method, url: req.url, key: req.headers["idempotency-key"], body: text ? JSON.parse(text) : null };
    requests.push(request);
    const { status = 200, data } = respond(request, requests.length);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  });
  await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());
  const client = new Client({ name: "application-contract-recovery", version: "1" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["build/index.js"], env: { ...process.env, VPSNET_API_KEY: "fictional-test-key", VPSNET_API_URL: `http://127.0.0.1:${api.address().port}` } }));
  t.after(() => client.close());
  return { client, requests };
}

for (const name of ["cancel_application_action", "update_application"]) {
  test(`${name} retries the identical backend request after current eligibility changes`, async t => {
    let posted = false;
    const { client, requests } = await connect(t, request => {
      if (request.method === "GET") return { data: { success: true, installation: { id: INSTALLATION, latest_action: { id: OPERATION, state: posted ? "cancelled" : "created", cancellable: !posted }, available_actions: posted ? [] : [{ type: "update", release: { blueprint_version: "2026.10.1", upstream_version: "1.2.3" } }] } } };
      const replayed = posted; posted = true;
      return { data: { success: true, replayed, installation: { id: INSTALLATION, state: "healthy" }, action: { id: OPERATION, type: name === "update_application" ? "update" : "stop", state: replayed ? "succeeded" : "created" } } };
    });
    const args = { ...base, idempotencyKey: "fictional-replay-key-12345", ...(name === "cancel_application_action" ? { action_id: OPERATION } : { expected_blueprint_version: "2026.10.1", expected_upstream_version: "1.2.3", confirmed: true }) };
    await client.callTool({ name, arguments: args });
    const retry = await client.callTool({ name, arguments: args });
    assert.notEqual(retry.isError, true);
    assert.equal(JSON.parse(retry.content[0].text).replayed, true);
    const posts = requests.filter(r => r.method === "POST");
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[1], posts[0]);
  });
}

test("rollback uses the version-bound lifecycle contract and destructive discovery", async t => {
  const { client, requests } = await connect(t, () => ({ data: { success: true, action: { id: OPERATION, type: "rollback", state: "created" } } }));
  const tools = (await client.listTools()).tools;
  const tool = tools.find(t => t.name === "rollback_application");
  assert.ok(tool);
  assert.equal(tool.annotations.destructiveHint, true);
  const result = await client.callTool({ name: tool.name, arguments: { ...base, expected_blueprint_version: "2026.09.1", expected_upstream_version: "1.2.2", idempotencyKey: "fictional-rollback-12345", confirmed: true } });
  assert.notEqual(result.isError, true);
  assert.deepEqual(requests.at(-1).body, { action: "rollback", expected_blueprint_version: "2026.09.1", expected_upstream_version: "1.2.2" });
});

test("persisted application operations poll the supplied ID through GET without recreating", async t => {
  const { client, requests } = await connect(t, req => {
    if (req.url.includes("/inspections/")) return { data: { success: true, inspection: { id: OPERATION, installation_id: INSTALLATION, kind: "logs", state: "succeeded", result: { logs: { content: "password=must-not-leak", line_count: 1 } } } } };
    if (req.url.includes("/validations/")) return { data: { success: true, validation: { id: OPERATION, compose_digest: DIGEST, state: "awaiting_reply", valid: null } } };
    return { data: { success: true, discovery: { id: OPERATION, state: "running" } } };
  });
  for (const [name, args, suffix] of [
    ["get_application_inspection", { ...base, inspection_id: OPERATION, kind: "logs" }, `/installations/${INSTALLATION}/inspections/${OPERATION}`],
    ["get_application_recipe_validation", { orderNo: base.orderNo, validation_id: OPERATION }, `/custom-projects/validations/${OPERATION}`],
    ["get_service_container_discovery", { orderNo: base.orderNo, discovery_id: OPERATION }, `/container-discoveries/${OPERATION}`],
  ]) {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true);
    assert.equal(requests.at(-1).method, "GET");
    assert.equal(requests.at(-1).url, `/account/services/VP12345/applications${suffix}`);
    assert.doesNotMatch(result.content[0].text, /must-not-leak/);
  }
  assert.equal(requests.length, 3);
});

test("inspection polling refuses a response for another installation or kind", async t => {
  const { client } = await connect(t, () => ({ data: { success: true, inspection: { id: OPERATION, installation_id: OTHER, kind: "health", state: "succeeded", result: { logs: { content: "must-not-leak" } } } } }));
  const result = await client.callTool({ name: "get_application_inspection", arguments: { ...base, inspection_id: OPERATION, kind: "logs" } });
  assert.equal(result.isError, true);
  assert.doesNotMatch(result.content[0].text, /must-not-leak/);
});

for (const name of ["create_application_recipe", "create_application_recipe_revision"]) test(`${name} resumes the exact completed validation without queuing another`, async t => {
  const { client, requests } = await connect(t, req => req.method === "GET"
    ? { data: { success: true, validation: { id: OPERATION, compose_digest: DIGEST, state: "succeeded", valid: true, timestamps: { expires_at: new Date(Date.now() + 600000).toISOString() } } } }
    : { data: { success: true, project: { id: OTHER, name: "example-app", current_revision: { revision: 1 } } } });
  const result = await client.callTool({ name, arguments: { orderNo: base.orderNo, ...(name === "create_application_recipe" ? { name: "example-app" } : { project_id: OTHER }), compose_yaml: COMPOSE, validation_id: OPERATION, idempotencyKey: "fictional-resume-key-12345", confirmed: true } });
  assert.notEqual(result.isError, true);
  assert.deepEqual(requests.map(r => r.method), ["GET", "POST"]);
  assert.equal(requests[0].url, `/account/services/VP12345/applications/custom-projects/validations/${OPERATION}`);
  assert.equal(requests[1].body.compose_yaml, COMPOSE);
});

for (const [reason, validation] of [
  ["expired", { state: "succeeded", valid: true, timestamps: { expires_at: "2020-01-01 00:00:00" } }],
  ["invalid", { state: "succeeded", valid: false, timestamps: { expires_at: "2099-01-01 00:00:00" } }],
  ["wrong ID", { id: OTHER, state: "succeeded", valid: true, timestamps: { expires_at: "2099-01-01 00:00:00" } }],
]) test(`recipe resume refuses ${reason} validation before saving`, async t => {
  const { client, requests } = await connect(t, () => ({ data: { success: true, validation: { id: OPERATION, compose_digest: DIGEST, ...validation } } }));
  const result = await client.callTool({ name: "create_application_recipe", arguments: { orderNo: base.orderNo, name: "example-app", compose_yaml: COMPOSE, validation_id: OPERATION, idempotencyKey: "fixture-invalid-" + "1".repeat(16), confirmed: true } });
  assert.equal(result.isError, true);
  assert.deepEqual(requests.map(r => r.method), ["GET"]);
});

test("recipe resume reports processing as pending without saving or dispatching again", async t => {
  const { client, requests } = await connect(t, () => ({ data: { success: true, validation: { id: OPERATION, compose_digest: DIGEST, state: "awaiting_reply", valid: null, timestamps: { expires_at: "2099-01-01 00:00:00" } } } }));
  const result = await client.callTool({ name: "create_application_recipe", arguments: { orderNo: base.orderNo, name: "example-app", compose_yaml: COMPOSE, validation_id: OPERATION, idempotencyKey: "fixture-pending-" + "1".repeat(16), confirmed: true } });
  assert.notEqual(result.isError, true);
  assert.equal(JSON.parse(result.content[0].text).validation.resolved_compose_yaml, COMPOSE);
  assert.deepEqual(requests.map(r => r.method), ["GET"]);
});

test("recipe resume refuses a completed validation for different Compose content", async t => {
  const { client, requests } = await connect(t, () => ({ data: { success: true, validation: { id: OPERATION, compose_digest: "b".repeat(64), state: "succeeded", valid: true } } }));
  const result = await client.callTool({ name: "create_application_recipe", arguments: { orderNo: base.orderNo, name: "example-app", compose_yaml: COMPOSE, validation_id: OPERATION, idempotencyKey: "fictional-refuse-key-12345", confirmed: true } });
  assert.equal(result.isError, true);
  assert.deepEqual(requests.map(r => r.method), ["GET"]);
});

test("remote discovery preserves durable POST hints and exposes scoped poll/rollback tools", () => {
  const registered = new Map();
  const server = { server: { setRequestHandler() {} }, registerTool(name, config) { registered.set(name, config); } };
  installRemotePolicy(server, ["applications:read", "applications:manage"]);
  for (const name of ["get_application_health", "get_application_logs", "discover_service_containers"]) {
    server.registerTool(name, { inputSchema: {}, annotations: { readOnlyHint: false, destructiveHint: false } }, async () => ({ content: [] }));
    assert.equal(registered.get(name).annotations.readOnlyHint, false, name);
  }
  for (const name of ["get_application_inspection", "get_application_recipe_validation", "get_service_container_discovery", "rollback_application"]) {
    server.registerTool(name, { inputSchema: {}, annotations: { readOnlyHint: name !== "rollback_application", destructiveHint: name === "rollback_application" } }, async () => ({ content: [] }));
    assert.ok(registered.has(name), name);
    assert.equal(registered.get(name)._meta.securitySchemes[0].scopes[0], name === "rollback_application" ? "applications:manage" : "applications:read");
  }
});

test("safe projections retain failure causes and a resumable pending pinned definition", () => {
  const points = safeApplicationDataRestorePointsPayload(200, { success: true, points: [], incompatiblePoints: 3, failedCaptures: 2, lastFailedCaptureAt: "2026-10-12 00:00:00", quote: { price_ex_vat: 1, vat_rate: 21, total_charged: 1.21, balance: 20, balance_sufficient: true }, activeRestore: null });
  assert.equal(points.incompatible_points, 3);
  assert.equal(points.failed_captures, 2);
  assert.equal(points.last_failed_capture_at, "2026-10-12 00:00:00");
  const failed = safeCustomProjectValidationPayload(200, { success: true, validation: { id: OPERATION, state: "failed", error_code: "applicationCustomProjectValidationTimedOut", errors: null } });
  assert.equal(failed.validation.error_code, "applicationCustomProjectValidationTimedOut");
  const unsafe = safeCustomProjectValidationPayload(200, { success: true, validation: { error_code: "password=must-not-leak" } });
  assert.equal(unsafe.validation.error_code, null);
  const pending = safeCustomProjectValidationPayload(200, { success: true, validation: { id: OPERATION, state: "awaiting_reply", valid: null, compose_digest: DIGEST, resolved_compose_yaml: COMPOSE } });
  assert.equal(pending.validation.resolved_compose_yaml, COMPOSE);
  assert.equal(pending.validation.compose_digest, DIGEST);
});
