import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

const registeredTools = [...source.matchAll(/server\.registerTool\(\s*"([^"]+)"/g)]
  .map((match) => match[1]);

const toolsStart = readme.indexOf("## Tools\n");
const toolsEnd = readme.indexOf("## Getting an API key", toolsStart);
const toolsSection = readme.slice(toolsStart, toolsEnd);
const documentedTools = [...toolsSection.matchAll(/^\| `([^`]+)` \|/gm)]
  .map((match) => match[1]);

test("README documents each registered tool exactly once", () => {
  assert.notEqual(toolsStart, -1);
  assert.notEqual(toolsEnd, -1);
  assert.deepEqual(
    [...new Set(documentedTools)].sort(),
    [...new Set(registeredTools)].sort()
  );
  assert.equal(documentedTools.length, new Set(documentedTools).size);
  assert.equal(registeredTools.length, new Set(registeredTools).size);
});

test("Firecracker snapshot guidance matches automatic-expiry semantics", () => {
  assert.match(source, /Firecracker snapshots expire automatically/);
  assert.doesNotMatch(
    source.match(/"create_firecracker_snapshot"[\s\S]*?server\.registerTool\(/)?.[0] ?? "",
    /do NOT auto-expire/
  );
  assert.match(toolsSection, /temporary Firecracker VPS snapshots and expiry/);
});
