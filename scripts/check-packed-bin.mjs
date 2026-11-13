#!/usr/bin/env node
// Release check: "the packed tarball answers through its bin".
// Packs the package (or takes a given .tgz), installs it into an empty temporary
// folder and starts it the way users do: node_modules/.bin/vpsnet-mcp (the
// symlink npm and global installs create), `npx --no-install vpsnet-mcp`,
// `npx -y --package=<tarball> vpsnet-mcp` and vpsnet-mcp-http. Each stdio start must answer `initialize` and `tools/list`.
// No real key or API is used: the key is a dummy and the handshake makes no API call.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, lstatSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const HANDSHAKE_MS = 30_000;

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout;
}

function cleanEnvironment(dir) {
  const env = { ...process.env, VPSNET_API_KEY: "vpsnet_packed-bin-check-dummy-key", npm_config_yes: "false" };
  for (const name of ["VPSNET_API_URL", "VPSNET_API_KEY_FILE", "VPSNET_MCP_RESOURCE"]) delete env[name];
  env.HOME = dir; // no sidecar key file or user configuration from the machine running the check
  env.npm_config_cache = process.env.npm_config_cache || join(process.env.HOME || dir, ".npm");
  return env;
}

async function handshake(label, command, args, cwd, env) {
  const transport = new StdioClientTransport({ command, args, cwd, env, stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += chunk; });
  const client = new Client({ name: "vpsnet-packed-bin-check", version: "1" });
  const timeout = (what) => new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: no ${what} answer within ${HANDSHAKE_MS} ms. stderr: ${stderr.slice(0, 600)}`)), HANDSHAKE_MS).unref());
  try {
    await Promise.race([client.connect(transport), timeout("initialize")]);
    const server = client.getServerVersion();
    const { tools } = await Promise.race([client.listTools(), timeout("tools/list")]);
    return { label, server: server?.name, version: server?.version, tools: tools.length };
  } catch (error) {
    throw new Error(`${label}: ${error.message}${stderr && !error.message.includes("stderr") ? ` stderr: ${stderr.slice(0, 600)}` : ""}`);
  } finally {
    await client.close().catch(() => {});
  }
}

function freePort() {
  return new Promise((resolvePromise, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolvePromise(port)); });
  });
}

async function httpListens(bin, cwd, env) {
  const port = await freePort();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, [], { cwd, env: { ...env, PORT: String(port) }, stdio: ["ignore", "ignore", "pipe"], shell: process.platform === "win32" });
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`vpsnet-mcp-http did not start within ${HANDSHAKE_MS} ms: ${stderr.slice(0, 600)}`)); }, HANDSHAKE_MS);
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.includes("listening")) { clearTimeout(timer); child.kill(); resolvePromise({ label: "node_modules/.bin/vpsnet-mcp-http", listening: true }); }
    });
    child.on("exit", (code) => { clearTimeout(timer); if (!stderr.includes("listening")) reject(new Error(`vpsnet-mcp-http exited (${code}) without listening: ${stderr.slice(0, 600)}`)); });
  });
}

export async function checkPackedBin(tarball) {
  const work = realpathSync(mkdtempSync(join(tmpdir(), "vpsnet-mcp-packed-")));
  try {
    if (!tarball) {
      const packed = JSON.parse(run(npm, ["pack", "--ignore-scripts", "--json", "--pack-destination", work], root))[0];
      tarball = join(work, packed.filename);
    }
    const given = resolve(tarball);
    // Work on a copy inside the temporary folder, so every install (and the npx cache entry) is traceable to it.
    tarball = join(work, `checked-${basename(given)}`);
    if (given !== tarball) copyFileSync(given, tarball);
    const project = join(work, "project");
    mkdirSync(project);
    writeFileSync(join(project, "package.json"), JSON.stringify({ name: "packed-bin-check", private: true }));
    run(npm, ["install", "--no-audit", "--no-fund", "--ignore-scripts", "--prefer-offline", "--no-package-lock", tarball], project);
    const pkg = JSON.parse(readFileSync(join(project, "node_modules", "vpsnet-mcp", "package.json"), "utf8"));
    const env = cleanEnvironment(work);
    const bin = join(project, "node_modules", ".bin", process.platform === "win32" ? "vpsnet-mcp.cmd" : "vpsnet-mcp");
    if (process.platform !== "win32" && !lstatSync(bin).isSymbolicLink()) throw new Error("node_modules/.bin/vpsnet-mcp is not a symlink; the check would not exercise the npx path");
    const results = [];
    results.push(await handshake("node_modules/.bin/vpsnet-mcp", bin, [], project, env));
    results.push(await handshake("npx --no-install vpsnet-mcp", npx, ["--no-install", "vpsnet-mcp"], project, env));
    // The documented `npx -y vpsnet-mcp`, with the exact tarball instead of the registry.
    results.push(await handshake("npx -y --package=<tarball> vpsnet-mcp", npx, ["-y", `--package=${tarball}`, "vpsnet-mcp"], work, env));
    results.push(await handshake("node build/index.js", process.execPath, [join(project, "node_modules", "vpsnet-mcp", "build", "index.js")], project, env));
    results.push(await httpListens(join(project, "node_modules", ".bin", process.platform === "win32" ? "vpsnet-mcp-http.cmd" : "vpsnet-mcp-http"), project, env));
    for (const result of results.filter((entry) => "tools" in entry)) {
      if (result.server !== "vpsnet" || result.version !== pkg.version) throw new Error(`${result.label}: answered as ${result.server} ${result.version}, expected vpsnet ${pkg.version}`);
      if (result.tools !== results[0].tools || result.tools < 1) throw new Error(`${result.label}: ${result.tools} tools, expected ${results[0].tools}`);
    }
    return { tarball: given.startsWith(work) ? "(packed from this checkout)" : given, sha256: createHash("sha256").update(readFileSync(tarball)).digest("hex"), version: pkg.version, results };
  } finally {
    removeNpxEntries(work);
    rmSync(work, { recursive: true, force: true });
  }
}

// `npx -y --package=<tarball>` leaves an install under <cache>/_npx/<hash>. Remove
// only the entries whose dependency points at this check's own temporary folder.
function removeNpxEntries(work) {
  const npxRoot = join(process.env.npm_config_cache || join(process.env.HOME || work, ".npm"), "_npx");
  let entries = [];
  try { entries = readdirSync(npxRoot); } catch { return; }
  for (const entry of entries) {
    try {
      const manifest = JSON.parse(readFileSync(join(npxRoot, entry, "package.json"), "utf8"));
      if (Object.values(manifest.dependencies || {}).some((spec) => String(spec).includes(basename(work)))) rmSync(join(npxRoot, entry), { recursive: true, force: true });
    } catch { /* not ours or unreadable */ }
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkPackedBin(process.argv[2]).then(
    (result) => console.log(JSON.stringify(result, null, 1)),
    (error) => { console.error(error.message); process.exitCode = 1; },
  );
}
