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
  // The literal is the guard: no dead runtime check behind it, and the handler
  // does not even read `confirmed`.
  assert.doesNotMatch(block, /confirmed !== true/);
  assert.match(block, /async \(\{ orderNo \}\) =>/);
  assert.match(block, /renewalPending/);
  assert.match(block, /destructiveHint: true/);
  assert.match(block, /serviceStillPaid/);
});
