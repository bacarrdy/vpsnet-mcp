import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build", "index.js");

// The base is where a full-access `vpsnet_` key gets sent, so every rejection
// below is a security control, not a preference. This file exists because the
// control shipped with no tests at all -- which is how it came to also reject
// loopback and break 37 of the suite's own tests without anyone noticing.
function startWith(apiUrl) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVER], {
      env: {
        ...process.env,
        VPSNET_API_KEY: "vpsnet_" + "t".repeat(43),
        VPSNET_API_URL: apiUrl,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      // A server that got past resolution keeps running; do not wait for it.
      if (stderr.includes("API base resolved to")) {
        child.kill("SIGKILL");
      }
    });
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

test("a hostile or non-vpsnet host is refused", async () => {
  for (const hostile of [
    "https://evilvpsnet.com",
    "https://api.vpsnet.com.evil.com",
    "https://attacker.example",
  ]) {
    const { stderr } = await startWith(hostile);
    assert.match(stderr, /Refusing to send the API key to untrusted host/, hostile);
    assert.doesNotMatch(stderr, /API base resolved to/, hostile);
  }
});

test("plain http to a remote host is refused", async () => {
  const { stderr } = await startWith("http://api.vpsnet.com");
  assert.match(stderr, /must use https/);
});

test("credentials, query and fragment are refused", async () => {
  for (const bad of [
    "https://user:pass@api.vpsnet.com",
    "https://api.vpsnet.com?key=1",
    "https://api.vpsnet.com#x",
  ]) {
    const { stderr } = await startWith(bad);
    assert.match(stderr, /must not carry credentials, query or fragment/, bad);
  }
});

test("a path is refused rather than silently dropped", async () => {
  const { stderr } = await startWith("https://api.vpsnet.com/api/v2");
  assert.match(stderr, /must not carry a path/);
});

test("loopback is allowed over http, so local harnesses and dev work", async () => {
  for (const local of ["http://127.0.0.1:9", "http://localhost:9", "http://[::1]:9"]) {
    const { stderr } = await startWith(local);
    assert.match(stderr, /API base resolved to/, local);
  }
});

test("the loopback exemption does not leak to non-loopback addresses", async () => {
  for (const remote of ["http://127.0.0.1.evil.com", "http://10.0.0.1:8013", "http://128.0.0.1"]) {
    const { stderr } = await startWith(remote);
    assert.match(stderr, /must use https|untrusted host/, remote);
    assert.doesNotMatch(stderr, /API base resolved to/, remote);
  }
});
