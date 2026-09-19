import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createApiConfiguration } from "../build/api-configuration.js";

const project = dirname(dirname(fileURLToPath(import.meta.url)));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vpsnet-mcp-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  writeFileSync(join(root, ".vpsnet-mcp-key"), "vpsnet_parent_decoy");
  return { root, workspace };
}

test("only the launch directory is searched, never its parent", (t) => {
  const { workspace } = fixture(t);
  assert.deepEqual(createApiConfiguration({}, workspace).apiKey(), { key: "", source: "" });
  writeFileSync(join(workspace, ".vpsnet-mcp-key"), "vpsnet_workspace\n");
  assert.equal(createApiConfiguration({}, workspace).apiKey().key, "vpsnet_workspace");
});

test("explicit directory and file select credentials without changing cwd", (t) => {
  const { root, workspace } = fixture(t);
  const keyFile = join(root, "chosen-key");
  writeFileSync(keyFile, "vpsnet_explicit\n");
  writeFileSync(join(workspace, ".mcp.json"), JSON.stringify({ mcpServers: { vpsnet: { env: {
    VPSNET_API_KEY: "vpsnet_json", VPSNET_API_URL: "https://api.vpsnet.com",
  } } } }));
  const configured = createApiConfiguration({ VPSNET_CONFIG_DIR: workspace }, root);
  assert.equal(configured.apiKey().key, "vpsnet_json");
  assert.equal(configured.apiUrl(), "https://api.vpsnet.com");
  assert.equal(createApiConfiguration({ VPSNET_API_KEY_FILE: keyFile }, workspace).apiKey().key, "vpsnet_explicit");
  assert.equal(createApiConfiguration({ VPSNET_API_KEY: "vpsnet_env", VPSNET_API_KEY_FILE: keyFile }, workspace).apiKey().key, "vpsnet_env");
  assert.throws(() => createApiConfiguration({ VPSNET_API_KEY_FILE: join(root, "missing") }, workspace).apiKey(), /No valid VPSnet API key/);
  assert.throws(() => createApiConfiguration({ VPSNET_CONFIG_DIR: "relative" }, workspace), /absolute/);
  assert.throws(() => createApiConfiguration({ VPSNET_API_KEY_FILE: "relative" }, workspace), /absolute/);
});

test("compiled checkout and npx-cache layouts read the same explicit workspace", (t) => {
  const { root, workspace } = fixture(t);
  writeFileSync(join(workspace, ".vpsnet-mcp-key"), "vpsnet_expected_account");
  for (const name of ["checkout", "_npx/cache/node_modules/vpsnet-mcp"]) {
    const install = join(root, name);
    mkdirSync(install, { recursive: true });
    cpSync(join(project, "build"), join(install, "build"), { recursive: true });
    writeFileSync(join(install, "package.json"), '{"type":"module"}');
    writeFileSync(join(install, ".vpsnet-mcp-key"), "vpsnet_install_decoy");
    const api = pathToFileURL(join(install, "build/api.js")).href;
    const script = `globalThis.fetch = async (url, init) => ({ status: 200, text: async () => JSON.stringify({ url, key: init.headers["X-API-KEY"] }) }); const {apiRequest} = await import(${JSON.stringify(api)}); console.log(JSON.stringify(await apiRequest("GET", "/read-only-fixture")));`;
    const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: workspace,
      env: { VPSNET_API_URL: "http://127.0.0.1:9" },
      encoding: "utf8", timeout: 10000,
    });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout).data, {
      url: "http://127.0.0.1:9/read-only-fixture", key: "vpsnet_expected_account",
    });
    assert.ok(child.stderr.includes(join(workspace, ".vpsnet-mcp-key")));
  }
});
