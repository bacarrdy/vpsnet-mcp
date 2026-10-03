import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("delete_service posts the explicit confirmation to the backend delete route", () => {
  assert.match(source, /server\.registerTool\(\s*"delete_service"/);
  assert.match(source, /svc\(orderNo, "delete"\),\s*\{\s*confirmDelete: true,?\s*\}/);
  assert.match(readme, /\| `delete_service` \|/);
});

test("delete_service cannot be called without the user's confirmation", () => {
  const start = source.indexOf('"delete_service"');
  const block = source.slice(start, source.indexOf("// --- Service Settings ---"));
  assert.match(block, /confirmed:\s*z\s*\.literal\(true\)/);
  assert.match(block, /if \(confirmed !== true\)/);
  assert.match(block, /destructiveHint: true/);
  assert.match(block, /serviceStillPaid/);
});
