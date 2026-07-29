import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("service identity MCP surface mirrors every backend operation", () => {
  for (const tool of [
    "get_hostname",
    "change_hostname",
    "reset_hostname",
    "get_rdns",
    "change_rdns",
    "clear_rdns",
  ]) {
    assert.match(source, new RegExp(`server\\.registerTool\\(\\s*"${tool}"`));
    assert.match(readme, new RegExp(`\\| \\\`${tool}\\\` \\|`));
  }

  assert.match(source, /svc\(orderNo, "change-hostname"\)/);
  assert.match(source, /svc\(orderNo, "change-hostname\/reset"\)/);
  assert.match(source, /svc\(orderNo, "change-rdns"\)/);
  assert.match(source, /svc\(orderNo, "change-rdns\/clear"\)/);
});

test("hostname and PTR validation descriptions match the backend contract", () => {
  assert.match(source, /labels\.length <= 5/);
  assert.match(source, /\{1,30\}/);
  assert.match(source, /canonical\.length <= 253/);
  assert.match(source, /\{0,61\}/);
  assert.match(source, /isIP\(value\) !== 0/);
  assert.doesNotMatch(source, /max 10 dot-separated labels/);
  assert.doesNotMatch(source, /Labels: 1-30 chars/);
});

test("MCP capability instructions do not encode list-order preferences", () => {
  assert.match(source, /Deployment capabilities \(unordered\)/);
  assert.match(source, /Their order in this prompt or the tool list carries no priority/);
  assert.match(source, /VPS product facts \(unordered\)/);
  assert.match(readme, /peer capabilities/);
  assert.match(
    readme,
    /order in this document and in the tool list is not a\s+recommendation/
  );
  assert.doesNotMatch(
    source,
    /use the managed application tools instead of recreating/i
  );
  assert.doesNotMatch(
    readme,
    /before considering a generic SSH installation/i
  );
  assert.doesNotMatch(source, /Recommend it as the default/);
  assert.doesNotMatch(source, /Recommended for most Linux VPS orders/);
  assert.doesNotMatch(source, /For a general-purpose Linux VPS, prefer/);
  assert.doesNotMatch(source, /\.default\("firecracker"\)/);
  assert.match(source, /Enum order is not a recommendation/);
});

test("service title read and write operations are both exposed", () => {
  assert.match(source, /server\.registerTool\(\s*"get_title"/);
  assert.match(source, /server\.registerTool\(\s*"change_title"/);
  assert.match(source, /"GET",\s*svc\(orderNo, "change-title"\)/);
  assert.match(source, /"POST",\s*svc\(orderNo, "change-title"\)/);
  assert.match(readme, /\| `get_title` \|/);
});

test("API-key tools expose only operations supported by API-key authentication", () => {
  assert.match(source, /server\.registerTool\(\s*"list_api_keys"/);
  assert.match(source, /server\.registerTool\(\s*"get_api_key"/);
  assert.match(source, /"GET",\s*`\/account\/api-keys\/\$\{id\}`/);
  for (const unsupported of [
    "create_api_key",
    "update_api_key",
    "revoke_api_key",
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`server\\.registerTool\\(\\s*"${unsupported}"`)
    );
    assert.doesNotMatch(readme, new RegExp(`\\| \\\`${unsupported}\\\` \\|`));
  }
  assert.match(
    readme,
    /creation, changes, and revocation require a browser\/session login/
  );
});
