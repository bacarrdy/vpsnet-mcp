import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createVpsnetServer } from "../build/index.js";
import { remoteScope } from "../build/remote-policy.js";

const ID = "550e8400-e29b-41d4-a716-446655440000";
const CSR = `-----BEGIN CERTIFICATE REQUEST-----\n${"QUJD".repeat(32)}\n-----END CERTIFICATE REQUEST-----\n`;
const KEY = "concrete-action-key-0001";
const app = { orderNo: "VP123", installation_id: ID, confirmed: true, idempotencyKey: KEY };
const free = { free_certificate_request_id: ID, acknowledge_free_certificate_action: true };
const acme = { certificate_subscription_id: ID, acknowledge_automatic_ssl_action: true, idempotencyKey: KEY };
const paid = { certificate_order_id: ID, acknowledge_certificate_action: true, idempotencyKey: KEY };

const actions = [
  ...["reconcile", "repair", "restart", "start", "stop"].map(action => ({
    name: `${action}_application`, args: app, action, family: "app", body: { action },
  })),
  { name: "uninstall_application", args: { ...app, acknowledge_data_loss: true }, action: "uninstall", family: "app", body: { action: "uninstall", acknowledgeDataLoss: true } },
  { name: "update_application", args: { ...app, expected_blueprint_version: "1.2.3", expected_upstream_version: "4.5.6" }, action: "update", family: "app", body: { action: "update", expected_blueprint_version: "1.2.3", expected_upstream_version: "4.5.6" } },
  { name: "renew_free_certificate", args: { ...free, csr: CSR }, action: "renew", family: "free", body: { csr: CSR } },
  { name: "revoke_free_certificate", args: { ...free, reason: "key_compromise" }, action: "revoke", family: "free", body: { reason: "key_compromise" } },
  { name: "recheck_free_certificate", args: free, action: "recheck", family: "free", body: {} },
  { name: "cancel_free_certificate", args: free, action: "cancel", family: "free", body: {} },
  { name: "cancel_automatic_ssl_subscription", args: { ...acme, reason: "No longer needed" }, action: "cancel", family: "acme", body: { reason: "No longer needed" } },
  { name: "remove_automatic_ssl_domain", args: { ...acme, domain_id: 42 }, action: "remove_domain", family: "acme", body: { domain_id: 42 } },
  { name: "replace_automatic_ssl_domain", args: { ...acme, domain_id: 42, new_domain: "new.example.com" }, action: "replace_domain", family: "acme", body: { domain_id: 42, new_domain: "new.example.com" } },
  { name: "cancel_certificate", args: { ...paid, reason: "No longer needed" }, action: "cancel", family: "paid", body: { reason: "No longer needed" } },
  { name: "recheck_certificate_validation", args: { ...paid, domains: ["example.com"] }, action: "recheck_validation", family: "paid", body: { domains: ["example.com"] } },
  { name: "resend_certificate_validation", args: paid, action: "resend_validation", family: "paid", body: {} },
  { name: "change_certificate_validation", args: { ...paid, domain: "example.com", validation_method: "dns-txt" }, action: "change_validation", family: "paid", body: { domain: "example.com", validation_method: "dns-txt" } },
  { name: "reissue_certificate", args: { ...paid, csr: CSR, common_name: { name: "example.com", validation_method: "dns-txt" }, alternative_names: [] }, action: "reissue", family: "paid", body: { csr: CSR, common_name: { name: "example.com", validation_method: "dns-txt" }, alternative_names: [] } },
];

function pathOf(entry) {
  if (entry.family === "app") return `/account/services/VP123/applications/installations/${ID}/actions`;
  if (entry.family === "free") return `/account/certificates/free/${ID}/actions/${entry.action}`;
  if (entry.family === "acme") return `/account/certificates/acme-subscriptions/${ID}/actions/${entry.action}`;
  return `/account/certificates/${ID}/actions/${entry.action}`;
}

async function apiHarness(t) {
  const requests = [];
  const api = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    res.setHeader("content-type", "application/json");
    if (req.method === "GET") {
      res.end(JSON.stringify({ success: true, installation: { id: ID, available_actions: [{ type: "update", release: { blueprint_version: "1.2.3", upstream_version: "4.5.6" } }] } }));
      return;
    }
    res.statusCode = 202;
    const action = req.url.split("/").at(-1);
    if (req.url.startsWith("/account/certificates/free/")) {
      res.end(JSON.stringify({ success: true, queued: true, action }));
    } else if (req.url.startsWith("/account/certificates/acme-subscriptions/")) {
      res.end(JSON.stringify({ success: true, action: {
        id: ID, action, state: "queued", outcome_ambiguous: false, attention_required: false,
        billing_state: "no_charge", amount: { currency: "EUR", net: "0.00" },
        target_domain_id: null, created_at: "2026-10-13 12:00:00", updated_at: "2026-10-13 12:00:00",
      } }));
    } else if (req.url.startsWith("/account/certificates/")) {
      res.end(JSON.stringify({ success: true, action: { id: ID, action, state: "queued" } }));
    } else {
      res.end(JSON.stringify({ success: true, queued: true, action: { id: ID, state: "queued" } }));
    }
  });
  await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());
  const client = new Client({ name: "explicit-operations-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["build/index.js"], env: {
    ...process.env, VPSNET_API_KEY: "contract-test-key", VPSNET_API_URL: `http://127.0.0.1:${api.address().port}`,
  } });
  await client.connect(transport);
  t.after(async () => client.close());
  return { client, requests };
}

test("all 19 concrete operations have fixed backend actions and scoped inputs", async t => {
  const { client, requests } = await apiHarness(t);
  const byName = new Map((await client.listTools()).tools.map(tool => [tool.name, tool]));
  assert.equal(actions.length, 19);
  for (const entry of actions) {
    const tool = byName.get(entry.name);
    assert.ok(tool, `${entry.name} is registered`);
    assert.equal(tool.inputSchema.properties.action, undefined, `${entry.name} cannot choose another action`);
    assert.equal(tool.inputSchema.properties.request, undefined, `${entry.name} cannot supply a generic request`);
    assert.equal(tool.inputSchema.properties.acknowledge_data_loss !== undefined, entry.name === "uninstall_application");
    assert.equal(tool.inputSchema.properties.expected_blueprint_version !== undefined, entry.name === "update_application");
    assert.equal(tool.inputSchema.required.includes("expected_blueprint_version"), entry.name === "update_application");
    assert.equal(tool.inputSchema.required.includes("acknowledge_data_loss"), entry.name === "uninstall_application");
    assert.equal(remoteScope(entry.name), entry.family === "app" ? "applications:manage" : "certificates:manage");
    const before = requests.length;
    const result = await client.callTool({ name: entry.name, arguments: { ...entry.args, action: "injected", request: { action: "injected" } } });
    assert.equal(result.isError, undefined, `${entry.name} succeeds with mocked API: ${result.content?.[0]?.text}`);
    const posted = requests.slice(before).find(request => request.method === "POST");
    assert.ok(posted, `${entry.name} sent a mutation`);
    assert.equal(posted.url, pathOf(entry));
    assert.deepEqual(posted.body, entry.body);
    if (entry.family !== "free") assert.equal(posted.headers["idempotency-key"], KEY);
    else assert.equal(posted.headers["idempotency-key"], undefined);
  }
});

test("remote discovery hides legacy aggregates but cached calls still route through scope checks", async t => {
  const server = createVpsnetServer({ remoteScopes: ["applications:read", "certificates:read"] });
  const client = new Client({ name: "remote-operations-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const byName = new Map((await client.listTools()).tools.map(tool => [tool.name, tool]));
  for (const entry of actions) {
    const tool = byName.get(entry.name);
    assert.ok(tool, `${entry.name} is advertised remotely`);
    const requiredScope = entry.family === "app" ? "applications:manage" : "certificates:manage";
    assert.deepEqual(tool._meta.securitySchemes[0].scopes, [requiredScope]);
    const denied = await client.callTool({ name: entry.name, arguments: entry.args });
    assert.equal(denied.isError, true, `${entry.name} denies missing scope`);
    assert.match(denied.content[0].text, new RegExp(`requires ${requiredScope}`));
  }
  const legacy = [
    ["manage_application", { ...app, action: "restart" }],
    ["manage_free_certificate", { ...free, request: { action: "cancel" } }],
    ["manage_automatic_ssl_subscription", { ...acme, request: { action: "cancel", reason: "No longer needed" } }],
    ["manage_certificate", { ...paid, request: { action: "cancel", reason: "No longer needed" } }],
  ];
  for (const [name, args] of legacy) {
    assert.equal(byName.has(name), false, `${name} is hidden from remote discovery`);
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /requires/);
  }
});

test("action-specific approvals and update preconditions fail before an API mutation", async t => {
  const { client, requests } = await apiHarness(t);
  const invalid = [
    ["uninstall_application", app],
    ["update_application", app],
    ["revoke_free_certificate", { free_certificate_request_id: ID, reason: "key_compromise" }],
    ["cancel_automatic_ssl_subscription", { certificate_subscription_id: ID, idempotencyKey: KEY, reason: "No longer needed" }],
    ["cancel_certificate", { certificate_order_id: ID, idempotencyKey: KEY, reason: "No longer needed" }],
  ];
  for (const [name, args] of invalid) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true, `${name} rejects an incomplete approval or precondition`);
  }
  assert.equal(requests.length, 0);
});
