import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("tools/list exposes customer recipe and read-only discovery contracts", async (t) => {
  const client = new Client({ name: "custom-project-contract", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    env: { ...process.env, VPSNET_API_KEY: "contract-test-key" },
  });

  await client.connect(transport);
  t.after(async () => client.close());

  const { tools } = await client.listTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  for (const name of [
    "validate_application_recipe",
    "list_application_recipes",
    "list_application_recipe_revisions",
    "create_application_recipe",
    "create_application_recipe_revision",
    "export_application_recipe",
    "install_application_recipe",
    "discover_service_containers",
  ]) {
    assert.ok(byName.has(name), `${name} must be registered`);
  }

  const create = byName.get("create_application_recipe");
  assert.equal(create.inputSchema.properties?.confirmed.const, true);
  assert.equal(create.inputSchema.properties?.compose_yaml.maxLength, 262144);
  assert.ok(create.inputSchema.properties?.secret_names);
  assert.equal(create.annotations?.destructiveHint, false);
  assert.match(create.description, /does not install or start containers/i);

  const revision = byName.get("create_application_recipe_revision");
  assert.equal(revision.inputSchema.properties?.project_id.format, "uuid");
  assert.match(revision.description, /rollback safety/i);
  assert.match(revision.description, /does not update the running installation/i);

  const exportRecipe = byName.get("export_application_recipe");
  assert.equal(exportRecipe.annotations?.readOnlyHint, true);
  assert.match(exportRecipe.description, /catalog recipes are not exportable/i);

  const install = byName.get("install_application_recipe");
  assert.equal(install.inputSchema.properties?.confirmed.const, true);
  assert.equal(
    install.inputSchema.properties?.acknowledge_recipe_risks.const,
    true
  );
  assert.match(install.description, /never repeat secret values/i);

  const discover = byName.get("discover_service_containers");
  assert.match(discover.description, /never returns environment values or mounts/i);
  assert.match(discover.description, /does not adopt or modify containers/i);
});
