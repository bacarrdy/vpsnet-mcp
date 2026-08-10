import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const INSTALLATION_ID = "b7ea0c2a-e6e4-4c25-87ca-c0cdf7e4ca42";

test("application resource guidance describes the opt-in email contract consistently", () => {
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(source, /Email is disabled by default/);
  assert.match(source, /one reached and one recovered message per threshold episode/);
  assert.doesNotMatch(source, /promise alerts/);
});

test("configure application resource thresholds replaces the complete display set", async (t) => {
  const requests = [];
  const api = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      method: req.method,
      url: req.url,
      body: body ? JSON.parse(body) : null,
    });
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      success: true,
      thresholds: {
        cpu_percent: 80,
        memory_mib: null,
        network_mib_per_minute: 250,
        restart_delta: 2,
        email_enabled: true,
        updated_at: "2026-08-05 10:00:00",
      },
    }));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());
  const address = api.address();

  const client = new Client({ name: "managed-resource-contract", version: "1.0.0" });
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
    name: "configure_application_resource_thresholds",
    arguments: {
      orderNo: "VP123",
      installation_id: INSTALLATION_ID,
      cpu_percent: 80,
      email_enabled: true,
      network_mib_per_minute: 250,
      restart_delta: 2,
      confirmed: true,
    },
  });

  assert.equal(result.isError, undefined);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "PUT");
  assert.equal(
    requests[0].url,
    `/account/services/VP123/applications/installations/${INSTALLATION_ID}/resource-thresholds`
  );
  assert.deepEqual(requests[0].body, {
    cpuPercent: 80,
    emailEnabled: true,
    memoryMiB: null,
    networkMiBPerMinute: 250,
    restartDelta: 2,
  });
});
