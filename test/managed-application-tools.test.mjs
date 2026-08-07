import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("tools/list exposes the backend-compatible managed application contract", async (t) => {
  const client = new Client({ name: "managed-application-contract", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    env: { ...process.env, VPSNET_API_KEY: "contract-test-key" },
  });

  await client.connect(transport);
  t.after(async () => {
    await client.close();
  });

  assert.equal(client.getServerVersion()?.name, "vpsnet");
  assert.equal(client.getServerVersion()?.version, "2.0.0");

  const { tools } = await client.listTools();
  const logs = tools.find((tool) => tool.name === "get_application_logs");
  const catalog = tools.find((tool) => tool.name === "list_application_catalog");
  const registryCredentials = tools.find(
    (tool) => tool.name === "list_application_registry_credentials"
  );
  const install = tools.find((tool) => tool.name === "install_application");
  const configureAccess = tools.find(
    (tool) => tool.name === "configure_application_access"
  );
  const configureResourceThresholds = tools.find(
    (tool) => tool.name === "configure_application_resource_thresholds"
  );
  const lifecycle = tools.find((tool) => tool.name === "manage_application");
  const cancelAction = tools.find(
    (tool) => tool.name === "cancel_application_action"
  );
  const listRestorePoints = tools.find(
    (tool) => tool.name === "list_application_restore_points"
  );
  const quoteRestore = tools.find(
    (tool) => tool.name === "quote_application_data_restore"
  );
  const restoreData = tools.find(
    (tool) => tool.name === "restore_application_data"
  );
  const getRestore = tools.find(
    (tool) => tool.name === "get_application_data_restore"
  );

  assert.ok(logs);
  assert.equal(logs.inputSchema.properties?.tail_lines.maximum, 500);
  assert.equal(logs.inputSchema.properties?.max_bytes.maximum, 131072);
  assert.equal(
    logs.inputSchema.properties?.service.pattern,
    "^[a-z0-9][a-z0-9_-]{0,62}$"
  );

  assert.ok(catalog);
  assert.doesNotMatch(catalog.description, /upstream publisher|support boundary|authorship/i);
  assert.match(catalog.description, /advisory CPU\/RAM\/disk sizing/i);
  assert.match(catalog.description, /must not block installation/i);

  assert.ok(registryCredentials);
  assert.deepEqual(
    Object.keys(registryCredentials.inputSchema.properties || {}),
    ["orderNo"]
  );
  assert.equal(registryCredentials.annotations?.readOnlyHint, true);
  assert.match(registryCredentials.description, /non-secret/i);
  assert.match(registryCredentials.description, /token creation and rotation.*unavailable through MCP/i);
  assert.doesNotMatch(
    JSON.stringify(registryCredentials.inputSchema),
    /token|password|credential_id/i
  );

  assert.ok(install);
  assert.equal(
    install.inputSchema.properties?.acknowledge_runtime_restart.const,
    true
  );
  assert.ok(install.inputSchema.properties?.access);
  assert.match(install.description, /portal handoff/i);
  assert.doesNotMatch(install.description, /support boundary|authorship/i);
  // No channel default: omitting release_channel lets the catalog resolve the
  // application's own published channel. A hardcoded "stable" rejected most
  // published applications.
  assert.ok(install.inputSchema.properties?.release_channel);
  assert.equal(
    "default" in install.inputSchema.properties.release_channel,
    false
  );
  assert.equal(
    (install.inputSchema.required || []).includes("release_channel"),
    false
  );

  assert.ok(configureAccess);
  assert.equal(configureAccess.inputSchema.properties?.confirmed.const, true);
  assert.ok(configureAccess.inputSchema.properties?.expected_revision);
  assert.ok(configureAccess.inputSchema.properties?.access);
  const accessSchema = JSON.stringify(
    configureAccess.inputSchema.properties?.access
  );
  assert.match(accessSchema, /"const":"platform_https"/);
  assert.match(accessSchema, /"schema_version"/);
  assert.match(accessSchema, /"const":2/);
  assert.match(accessSchema, /"endpoints"/);
  assert.match(configureAccess.description, /customer-managed URL/i);
  assert.match(configureAccess.description, /does not configure or validate/i);

  assert.ok(configureResourceThresholds);
  assert.equal(
    configureResourceThresholds.inputSchema.properties?.confirmed.const,
    true
  );
  assert.equal(
    configureResourceThresholds.inputSchema.properties?.cpu_percent.anyOf?.find(
      (schema) => schema.type === "integer"
    )?.maximum,
    6400
  );
  assert.equal(
    configureResourceThresholds.inputSchema.properties?.restart_delta.anyOf?.find(
      (schema) => schema.type === "integer"
    )?.maximum,
    1000
  );
  assert.equal(configureResourceThresholds.annotations?.idempotentHint, true);
  assert.match(configureResourceThresholds.description, /display-threshold/i);
  assert.match(configureResourceThresholds.description, /do not.*affect billing/i);
  assert.match(
    configureResourceThresholds.description,
    /not a paid API-key operation/i
  );

  assert.ok(lifecycle);
  const actions = lifecycle.inputSchema.properties?.action.enum;
  assert.ok(Array.isArray(actions));
  assert.ok(actions.includes("update"));
  assert.equal(actions.includes("backup"), false);
  assert.equal(actions.includes("restore"), false);
  assert.equal(lifecycle.inputSchema.properties?.confirmed.const, true);
  assert.ok(cancelAction);
  assert.ok(listRestorePoints);
  assert.ok(quoteRestore);
  assert.ok(restoreData);
  assert.ok(getRestore);
  assert.equal(listRestorePoints.annotations?.readOnlyHint, true);
  assert.equal(restoreData.annotations?.destructiveHint, true);
  assert.equal(getRestore.annotations?.readOnlyHint, true);
  assert.equal(
    restoreData.inputSchema.properties?.acknowledge_data_replacement.const,
    true
  );
  assert.ok(restoreData.inputSchema.properties?.expected_revision);
  assert.ok(restoreData.inputSchema.properties?.backup_point_id);
  assert.doesNotMatch(
    JSON.stringify(restoreData.inputSchema),
    /pbs|archive|filesystem|device|path/i
  );
  const idempotencyPattern = "^[A-Za-z0-9][A-Za-z0-9._:-]{7,189}$";
  for (const tool of [
    install,
    configureAccess,
    lifecycle,
    cancelAction,
  ]) {
    const schema = tool.inputSchema.properties?.idempotencyKey;
    assert.equal(schema.minLength, 8);
    assert.equal(schema.maxLength, 190);
    assert.equal(schema.pattern, idempotencyPattern);
  }
  for (const tool of [quoteRestore, restoreData]) {
    const schema = tool.inputSchema.properties?.idempotencyKey;
    assert.equal(schema.minLength, 16);
    assert.equal(schema.maxLength, 190);
    assert.equal(schema.pattern, idempotencyPattern);
  }
  const idempotencyKey = new RegExp(idempotencyPattern);
  assert.match("A1234567", idempotencyKey);
  assert.match(`A${"b".repeat(189)}`, idempotencyKey);
  assert.doesNotMatch("A123456", idempotencyKey);
  assert.doesNotMatch("-1234567", idempotencyKey);
  assert.doesNotMatch("A123/567", idempotencyKey);
  assert.doesNotMatch("A123 567", idempotencyKey);
  assert.match(
    lifecycle.inputSchema.properties?.idempotencyKey.description,
    /client-global/i
  );
  assert.ok(lifecycle.inputSchema.properties?.expected_blueprint_version);
  assert.ok(lifecycle.inputSchema.properties?.expected_upstream_version);
  assert.match(lifecycle.description, /execution preconditions/i);

  assert.equal(cancelAction.inputSchema.properties?.action_id.format, "uuid");
  assert.match(cancelAction.description, /latest_action\.cancellable=true/i);
  assert.match(cancelAction.description, /pre-dispatch/i);
  assert.match(
    cancelAction.description,
    /never stops or interrupts a running worker job/i
  );
  assert.match(cancelAction.description, /requires applications:manage/i);
  assert.match(cancelAction.description, /fresh client-global idempotencyKey/i);
  assert.match(
    cancelAction.inputSchema.properties?.idempotencyKey.description,
    /do not reuse the original action's key/i
  );
});
