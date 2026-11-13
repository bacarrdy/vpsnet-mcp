import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { isEntrypoint } from "../build/entrypoint.js";

function fixture(t) {
  // Space, '#', '%' and non-ASCII characters are percent-encoded in a file: URL.
  const dir = mkdtempSync(join(tmpdir(), "vpsnet entry #%ą-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "pkg", "build"), { recursive: true });
  mkdirSync(join(dir, "bin"));
  const file = join(dir, "pkg", "build", "index.js");
  writeFileSync(file, "");
  return { dir, file, url: pathToFileURL(file).href };
}

test("a direct start matches, also when the path has percent-encoded characters", (t) => {
  const { file, url } = fixture(t);
  assert.match(url, /%23|%25|%C4%85|%20/);
  assert.equal(isEntrypoint(url, file), true);
});

test("a start through a symlink (npx, global install, node_modules/.bin) matches", { skip: process.platform === "win32" && "symlinks need privileges on Windows" }, (t) => {
  const { dir, file, url } = fixture(t);
  const link = join(dir, "bin", "vpsnet-mcp");
  symlinkSync(relative(join(dir, "bin"), file), link);
  assert.equal(isEntrypoint(url, link), true);
});

test("a relative argv[1] is resolved against the working directory", (t) => {
  const { file, url } = fixture(t);
  assert.equal(isEntrypoint(url, relative(process.cwd(), file)), true);
});

test("no argv[1], another script, or a path that does not exist do not start the server", (t) => {
  const { dir, url } = fixture(t);
  assert.equal(isEntrypoint(url, undefined), false);
  assert.equal(isEntrypoint(url, ""), false);
  assert.equal(isEntrypoint(url, join(dir, "bin", "other.js")), false);
  assert.equal(isEntrypoint(url, join(dir, "missing", "index.js")), false);
  assert.equal(isEntrypoint("not a url", join(dir, "pkg", "build", "index.js")), false);
});

test("a path that does not exist on disk is compared as given", () => {
  const missing = join(tmpdir(), "vpsnet-entry-missing", "index.js");
  assert.equal(isEntrypoint(pathToFileURL(missing).href, missing), true);
});

test("Windows compares case-insensitively, including the drive letter; other systems do not", () => {
  const identity = (path) => path;
  const url = pathToFileURL(join(tmpdir(), "Pkg", "Build", "index.js")).href;
  const differentCase = join(tmpdir(), "Pkg", "Build", "index.js").replace("Pkg", "pkg").replace("Build", "BUILD");
  assert.equal(isEntrypoint(url, differentCase, { platform: "win32", realpath: identity }), true);
  assert.equal(isEntrypoint(url, differentCase, { platform: "linux", realpath: identity }), false);
});

test("a realpath failure falls back to the plain path instead of throwing", (t) => {
  const { file, url } = fixture(t);
  const failing = () => { throw Object.assign(new Error("EACCES"), { code: "EACCES" }); };
  assert.equal(isEntrypoint(url, file, { realpath: failing }), true);
});

test("importing the package entry does not start the stdio server", async () => {
  const module = await import("../build/index.js");
  assert.equal(typeof module.createVpsnetServer, "function");
});
