import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("paid function invokes carry one backend-enforced idempotency key", () => {
  const start = source.indexOf('server.registerTool(\n  "invoke_function"');
  const end = source.indexOf("server.registerTool(", start + 1);
  const tool = source.slice(start, end);

  assert.notEqual(start, -1);
  assert.match(tool, /idempotency_key: paidIdempotencyKeySchema/);
  assert.match(tool, /const key = idempotency_key \?\? randomUUID\(\)/);
  assert.match(tool, /\{ "Idempotency-Key": key \}/);
  assert.match(tool, /destructiveHint: true/);
  assert.match(tool, /idempotentHint: true/);
  assert.match(readme, /stable Idempotency-Key prevents exact retries/);
});
