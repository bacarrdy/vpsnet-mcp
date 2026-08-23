import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { safeApplicationRegistryCredentialPayload } from "../build/application-contract.js";

test("registry metadata tool uses the exact read route and strips secret fields", async (t) => {
  const requests = [];
  const api = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      success: true,
      credentials: [{
        id: "550e8400-e29b-41d4-a716-446655440040",
        registry: "ghcr.io",
        username: "customer",
        created_at: "2026-07-29 10:00:00",
        updated_at: "2026-07-29 11:00:00",
        rotated_at: "2026-07-29 11:00:00",
        token_present: true,
        token: "ghp_must_never_reach_the_model",
        ciphertext: "encrypted-secret",
        fingerprint: "secret-fingerprint",
        key_version: 7,
      }, {
        id: "550e8400-e29b-41d4-a716-446655440041",
        registry: "registry.customer.example.com:5443",
        username: "customer-two",
        created_at: "2026-07-29 10:00:00",
        updated_at: "2026-07-29 11:00:00",
        rotated_at: null,
        token_present: true,
        token: "second-secret-must-never-reach-the-model",
      }],
    }));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());
  const address = api.address();

  const client = new Client({ name: "registry-contract", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    env: {
      ...process.env,
      VPSNET_API_KEY: "contract-test-key",
      VPSNET_API_URL: `http://127.0.0.1:${address.port}`,
    },
  });
  await client.connect(transport);
  t.after(async () => client.close());

  const result = await client.callTool({
    name: "list_application_registry_credentials",
    arguments: { orderNo: "VP123" },
  });
  const text = result.content[0]?.text || "";
  const payload = JSON.parse(text);

  assert.equal(result.isError, undefined);
  assert.deepEqual(requests, [{
    method: "GET",
    url: "/account/services/VP123/applications/registry-credentials",
  }]);
  assert.deepEqual(payload, {
    success: true,
    credentials: [{
      id: "550e8400-e29b-41d4-a716-446655440040",
      registry: "ghcr.io",
      username: "customer",
      created_at: "2026-07-29 10:00:00",
      updated_at: "2026-07-29 11:00:00",
      rotated_at: "2026-07-29 11:00:00",
      token_present: true,
    }, {
      id: "550e8400-e29b-41d4-a716-446655440041",
      registry: "registry.customer.example.com:5443",
      username: "customer-two",
      created_at: "2026-07-29 10:00:00",
      updated_at: "2026-07-29 11:00:00",
      rotated_at: null,
      token_present: true,
    }],
  });
  assert.doesNotMatch(
    text,
    /ghp_must_never|second-secret|encrypted-secret|secret-fingerprint|key_version/
  );
});

test("registry metadata preserves the backend maximum of eight safe custom hosts", async (t) => {
  const registries = [
    "docker.io",
    "ghcr.io",
    "registry.one.example.com",
    "registry.two.example.com:443",
    "registry.three.example.com:5443",
    "registry.four.example.com",
    "registry.five.example.com",
    "registry.six.example.com",
    "https://registry.invalid/path",
  ];
  const api = createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      success: true,
      credentials: registries.map((registry, index) => ({
        id: `550e8400-e29b-41d4-a716-4466554400${String(index + 50).padStart(2, "0")}`,
        registry,
        username: `customer-${index}`,
        created_at: "2026-07-29 10:00:00",
        updated_at: "2026-07-29 11:00:00",
        rotated_at: null,
        token_present: true,
      })),
    }));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());
  const address = api.address();

  const client = new Client({ name: "registry-limit-contract", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    env: {
      ...process.env,
      VPSNET_API_KEY: "contract-test-key",
      VPSNET_API_URL: `http://127.0.0.1:${address.port}`,
    },
  });
  await client.connect(transport);
  t.after(async () => client.close());

  const result = await client.callTool({
    name: "list_application_registry_credentials",
    arguments: { orderNo: "VP123" },
  });
  const payload = JSON.parse(result.content[0]?.text || "{}");

  assert.equal(payload.credentials.length, 8);
  assert.deepEqual(
    payload.credentials.map((credential) => credential.registry),
    registries.slice(0, 8)
  );
  assert.equal(JSON.stringify(payload).includes("registry.invalid"), false);
});

test("registry metadata fails closed for unsafe host values", () => {
  const unsafe = [
    "https://registry.example.com/path",
    "registry.local",
    "127.0.0.1",
    "Registry.example.com",
    "registry.example.com:65536",
  ];
  const payload = safeApplicationRegistryCredentialPayload(200, {
    success: true,
    credentials: unsafe.map((registry, index) => ({
      id: `550e8400-e29b-41d4-a716-4466554400${String(index + 70).padStart(2, "0")}`,
      registry,
      username: `customer-${index}`,
      created_at: "2026-07-29 10:00:00",
      updated_at: "2026-07-29 11:00:00",
      rotated_at: null,
      token_present: true,
    })),
  });

  assert.deepEqual(
    payload.credentials.map((credential) => credential.registry),
    [null, null, null, null, null]
  );
});
