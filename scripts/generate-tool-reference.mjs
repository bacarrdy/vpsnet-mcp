#!/usr/bin/env node
// Keeps the README "## Tools" reference in step with the registered tools.
//
//   node scripts/generate-tool-reference.mjs          rewrite the tables between
//                                                     <!-- tool-reference:start --> and <!-- tool-reference:end -->
//   node scripts/generate-tool-reference.mjs --check  exit 1 (and say why) when the README is stale
//
// Names come from src/index.ts (server.registerTool) and the compiled
// networking registry (build/networking-tools.js, so run `npm run build` first).
// Scope/Paid cells come from scripts/tool-scopes.json for src/index.ts tools and
// are DERIVED from the registration options for networking tools. Row
// descriptions stay hand-written; a tool with no row gets one appended under
// "Not yet categorised" with the first sentence of its code description.
// Dependency-free: node builtins only.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const START = "<!-- tool-reference:start -->";
const END = "<!-- tool-reference:end -->";
export const SCOPE_TOKEN = /\b[a-z]+:(?:read|manage|write|rescue|restore|order|renew|transfer|invoke)\b/g;

export function indexTools() {
  const source = readFileSync(new URL("src/index.ts", root), "utf8");
  const found = [...source.matchAll(/server\.registerTool\(\s*"([^"]+)"/g)].map((m) => ({ name: m[1], at: m.index }));
  return found.map((tool, i) => {
    const block = source.slice(tool.at, i + 1 < found.length ? found[i + 1].at : source.length);
    const head = block.slice(0, block.indexOf("inputSchema"));
    const literals = [...(head.split("description:")[1] ?? "").matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
    return { name: tool.name, description: literals.join(" ").replace(/\\"/g, '"'), head };
  });
}

export async function networkingTools() {
  // api.js resolves a key at import time; the generator never sends a request.
  process.env.VPSNET_API_KEY ||= "vpsnet_" + "x".repeat(43);
  const module = await import(new URL("build/networking-tools.js", root));
  return module.networkingTools;
}

const ticks = (text) => text.replace(SCOPE_TOKEN, (token) => `\`${token}\``);
export const scopeCell = (scopes) =>
  scopes.length === 0 ? "none" : scopes.map((scope) => scope.split(" or ").map((x) => `\`${x}\``).join(" or ")).join(" + ");
export const paidCell = (paid) => (paid ? ticks(paid) : "free");

/** Scope/Paid cells for a networking tool, derived from how it is registered. */
export function networkingCells(tool) {
  if (tool.path.startsWith("/public/")) return { scopes: [], paid: "" };
  const { options } = tool;
  if (options.paid) return { scopes: ["networking:manage"], paid: "Paid: networking:order" };
  if (options.quote) return { scopes: ["networking:manage"], paid: "Quote: networking:order" };
  return { scopes: [options.readOnly ? "networking:read" : "networking:manage"], paid: "" };
}

export function firstSentence(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  const end = clean.search(/[.!?](\s|$)/);
  return (end === -1 ? clean : clean.slice(0, end + 1)).replace(/\|/g, "/");
}

/** name -> { scopes, paid, description, kind } for every registered tool. */
export async function expectedTools() {
  const metadata = JSON.parse(readFileSync(new URL("scripts/tool-scopes.json", root), "utf8"));
  const result = new Map();
  for (const tool of indexTools()) {
    result.set(tool.name, { ...(metadata[tool.name] ?? null), code: tool.description, kind: "index", missingMetadata: !metadata[tool.name] });
  }
  for (const tool of await networkingTools()) {
    result.set(tool.name, { ...networkingCells(tool), code: tool.description, kind: "networking" });
  }
  return { tools: result, metadata };
}

const HEADER = "| Tool | Description | Scope | Paid |";
const SEPARATOR = "|------|-------------|-------|------|";

export function regionOf(readme) {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start === -1 || end === -1 || end < start) throw new Error(`README needs ${START} ... ${END} around the tool tables`);
  return { start: start + START.length, end };
}

export function parseRow(line) {
  const match = line.match(/^\| `([^`]+)` \| (.*) \|$/);
  if (!match) return null;
  const parts = match[2].split(" | ");
  return parts.length >= 3
    ? { name: match[1], description: parts.slice(0, -2).join(" | "), scope: parts.at(-2), paid: parts.at(-1) }
    : { name: match[1], description: match[2], scope: null, paid: null };
}

/** Returns { text, problems } where text is the README the generator would write. */
export async function render(readme) {
  const { tools } = await expectedTools();
  const { start, end } = regionOf(readme);
  const problems = [];
  const seen = new Set();
  const lines = readme.slice(start, end).split("\n").flatMap((line) => {
    if (line === "| Tool | Description |" || line === HEADER) return [HEADER];
    if (line === "|------|-------------|" || line === SEPARATOR) return [SEPARATOR];
    const row = parseRow(line);
    if (!row) return [line];
    if (!tools.has(row.name)) {
      problems.push(`README row \`${row.name}\` names a tool that is not registered`);
      return [];
    }
    if (seen.has(row.name)) problems.push(`README lists \`${row.name}\` more than once`);
    seen.add(row.name);
    const tool = tools.get(row.name);
    return [`| \`${row.name}\` | ${row.description} | ${scopeCell(tool.scopes ?? [])} | ${paidCell(tool.paid)} |`];
  });
  const added = [];
  for (const [name, tool] of tools) {
    if (seen.has(name)) continue;
    problems.push(`registered tool \`${name}\` has no README row`);
    added.push(`| \`${name}\` | ${firstSentence(tool.code) || "TODO describe"} | ${scopeCell(tool.scopes ?? [])} | ${paidCell(tool.paid)} |`);
  }
  for (const [name, tool] of tools) {
    if (tool.missingMetadata) problems.push(`tool \`${name}\` has no entry in scripts/tool-scopes.json`);
  }
  let body = lines.join("\n");
  if (added.length > 0) body = `${body.replace(/\s*$/, "\n")}\n### Not yet categorised\n${HEADER}\n${SEPARATOR}\n${added.join("\n")}\n\n`;
  return { text: readme.slice(0, start) + body + readme.slice(end), problems };
}

async function main() {
  const file = new URL("README.md", root);
  const readme = readFileSync(file, "utf8");
  const { text, problems } = await render(readme);
  if (process.argv.includes("--check")) {
    if (text !== readme || problems.length > 0) {
      console.error("README tool reference is stale. Run `npm run docs:tools` and commit.");
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exit(1);
    }
    console.log("README tool reference is up to date.");
    return;
  }
  writeFileSync(file, text);
  for (const problem of problems) console.log(`fixed: ${problem}`);
  console.log("README tool reference regenerated.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
