import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

const networkingSource = readFileSync(new URL("../src/networking-tools.ts", import.meta.url), "utf8");
const registeredTools = [
  ...[...source.matchAll(/server\.registerTool\(\s*"([^"]+)"/g)].map(match => match[1]),
  ...[...networkingSource.matchAll(/^  tool\("([^"]+)"/gm)].map(match => match[1]),
];

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

// Scope / paid columns and generator parity (scripts/generate-tool-reference.mjs).
process.env.VPSNET_API_KEY ||= "vpsnet_" + "x".repeat(43);
const generator = await import("../scripts/generate-tool-reference.mjs");

test("README tool tables are exactly what the generator writes (run `npm run docs:tools`)", async () => {
  const { text, problems } = await generator.render(readme);
  assert.deepEqual(problems, []);
  assert.equal(text, readme);
});

test("every README tool row states its scope and paid status", () => {
  const rows = toolsSection.split("\n").map(generator.parseRow).filter(Boolean);
  assert.equal(rows.length, registeredTools.length);
  for (const row of rows) {
    assert.ok(row.scope && row.scope.length > 0, `${row.name}: Scope cell missing`);
    assert.ok(row.paid && row.paid.length > 0, `${row.name}: Paid cell missing`);
    assert.ok(row.description.length > 0, `${row.name}: description missing`);
  }
});

test("scopes named in a tool's code description appear in its README row", async () => {
  const { tools } = await generator.expectedTools();
  const rows = new Map(toolsSection.split("\n").map(generator.parseRow).filter(Boolean).map((row) => [row.name, row]));
  for (const [name, tool] of tools) {
    if (tool.kind !== "index") continue; // networking descriptions carry generic text; their cells are derived
    const cells = `${rows.get(name).scope} ${rows.get(name).paid}`;
    for (const token of new Set(tool.code.match(generator.SCOPE_TOKEN) ?? [])) {
      assert.ok(cells.includes(token), `${name}: description requires ${token} but the README row says "${cells}"`);
    }
  }
});

test("networking rows are scoped from how the tool is registered", async () => {
  const { tools } = await generator.expectedTools();
  for (const [name, tool] of tools) {
    if (tool.kind !== "networking") continue;
    if (tool.scopes.length === 0) continue; // public payment-method catalog
    assert.match(tool.scopes[0], /^networking:(read|manage)$/, name);
    if (/^(order|renew)_|^renew_/.test(name) && tool.paid) assert.match(tool.paid, /^Paid/, name);
  }
});

test("the README documents authentication, rate limits and worked examples", () => {
  for (const pattern of [/X-API-KEY/, /AI-scoped key/, /\b429\b/, /paid_operations_enabled/,
    /### Order a VPS \(quote, then confirm\)/, /### Networking \(quote, then order\)/,
    /### DNS record upsert/, /### Order a paid certificate/]) {
    assert.match(readme, pattern);
  }
});
