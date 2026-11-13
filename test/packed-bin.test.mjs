import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPackedBin } from "../scripts/check-packed-bin.mjs";

// The documented start is `npx -y vpsnet-mcp`: npx and global installs run the
// bin through a symlink. Importing build/index.js (as the other tests do) never
// exercises that path, so the packed tarball is installed and started through
// its bin, through npx, directly, and the HTTP bin.
test("the packed tarball answers initialize and tools/list through its bin and npx", { timeout: 300_000 }, async () => {
  const result = await checkPackedBin();
  const stdio = result.results.filter((entry) => "tools" in entry);
  assert.deepEqual(stdio.map((entry) => entry.label), ["node_modules/.bin/vpsnet-mcp", "npx --no-install vpsnet-mcp", "npx -y --package=<tarball> vpsnet-mcp", "node build/index.js"]);
  for (const entry of stdio) {
    assert.equal(entry.server, "vpsnet");
    assert.equal(entry.version, result.version);
    assert.ok(entry.tools > 0);
  }
  assert.equal(result.results.find((entry) => entry.label === "node_modules/.bin/vpsnet-mcp-http")?.listening, true);
});
