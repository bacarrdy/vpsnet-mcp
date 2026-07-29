import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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
    }],
  });
  assert.doesNotMatch(
    text,
    /ghp_must_never|encrypted-secret|secret-fingerprint|key_version/
  );
});
