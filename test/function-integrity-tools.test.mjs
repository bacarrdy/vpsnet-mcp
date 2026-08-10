import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("function updates preserve the unreadable-data replacement fence", () => {
  const updateStart = source.indexOf('server.registerTool(\n  "update_function"');
  const updateEnd = source.indexOf("server.registerTool(", updateStart + 1);
  const updateTool = source.slice(updateStart, updateEnd);

  assert.notEqual(updateStart, -1);
  assert.match(updateTool, /Call get_function first/);
  assert.match(updateTool, /acknowledge_unreadable_replacement: z\.boolean\(\)\.optional\(\)/);
  assert.match(source, /"acknowledge_unreadable_replacement",/);
  assert.match(
    source,
    /Only then pass acknowledge_unreadable_replacement=true/
  );
  assert.match(
    readme,
    /unreadable protected values require explicit replacement approval/
  );
});
