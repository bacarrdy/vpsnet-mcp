import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// API-MCP-02 (2026-11-13): the VPN is one product with its own price (owner 2026-11-10: no plan binding), and personal
// devices may use the built-in IKEv2 client where the gateway advertises it. No shipped text may say otherwise.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const skillCopies = [
  "plugin/skills/vpsnet-operations/SKILL.md",
  "plugin/skills/vpsnet-operations/references/execution.md",
  "skills/vpsnet-operations/SKILL.md",
  "skills/vpsnet-operations/references/execution.md",
  "distribution/standalone-skills/vpsnet-operations/SKILL.md",
  "distribution/standalone-skills/vpsnet-operations/references/execution.md",
  "distribution/standalone-skills/vpsnet-deploy/references/execution.md",
  "distribution/standalone-skills/vpsnet-functions/references/execution.md",
  "distribution/standalone-skills/vpsnet-troubleshoot/references/execution.md",
];

test("VPN device guidance names the capability-gated IKEv2 device client in every shipped copy", () => {
  for (const path of skillCopies) {
    const text = read(path);
    assert.doesNotMatch(text, /Personal devices use WireGuard\./, path);
    assert.match(text, /Personal devices use WireGuard, or the operating system's built-in IPsec IKEv2 client \(protocol `ipsec_ikev2`\) only when that gateway advertises `capabilities\.device_ikev2`\./, path);
  }
});

test("the VPN quote is not described as tied to a server plan", () => {
  for (const path of ["src/networking-tools.ts", "src/tool-annotations.ts"]) {
    const text = read(path);
    assert.doesNotMatch(text, /VPN product based on the current Firecracker plan/, path);
    assert.match(text, /The VPN has its own price, read from this quote; it is not tied to any server plan\./, path);
  }
});
