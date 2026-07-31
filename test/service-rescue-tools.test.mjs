import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";

const session = (state, operation = "enter") => ({
  id: SESSION_ID,
  platform: "firecracker",
  image: "ubuntu-24.04",
  state,
  active: state === "active",
  desiredState: operation === "enter" ? "active" : "inactive",
  operation,
  progressPercent: state === "active" ? 100 : 0,
  progressStage: state === "active" ? "active" : "queued",
  originalRunning: true,
  errorCode: null,
  activatedAt: state === "active" ? "2026-07-31 12:00:00" : null,
  completedAt: null,
  createdAt: "2026-07-31 11:59:00",
  updatedAt: "2026-07-31 12:00:00",
});

const capability = {
  supported: true,
  enabled: true,
  platform: "firecracker",
  images: [{
    id: "ubuntu-24.04",
    family: "linux",
    console: "serial",
    mountPath: "/mnt/customer",
    device: "/dev/vdb",
  }],
};

test("service rescue tools preflight and preserve exact HTTP bindings", async (t) => {
  const requests = [];
  let currentSession = null;
  const api = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: body ? JSON.parse(body) : null,
    });

    let status = 200;
    let response;
    if (req.method === "GET" && req.url === "/account/services/VP123/rescue") {
      response = {
        success: true,
        rescue: { capability, session: currentSession },
      };
    } else if (
      req.method === "POST"
      && req.url === "/account/services/VP123/rescue"
    ) {
      status = 202;
      response = {
        success: true,
        replayed: false,
        retried: false,
        session: session("queued"),
      };
      currentSession = session("active");
    } else if (
      req.method === "DELETE"
      && req.url === "/account/services/VP123/rescue"
    ) {
      status = 202;
      response = {
        success: true,
        replayed: false,
        retried: false,
        session: session("queued", "exit"),
      };
    } else {
      status = 404;
      response = { notFound: true };
    }

    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(response));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());
  const address = api.address();

  const client = new Client({ name: "service-rescue", version: "1.0.0" });
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

  const { tools } = await client.listTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  assert.equal(byName.get("get_service_rescue").annotations?.readOnlyHint, true);
  assert.equal(byName.get("enter_service_rescue").annotations?.destructiveHint, true);
  assert.equal(
    byName.get("enter_service_rescue").inputSchema.properties
      ?.acknowledge_reboot.const,
    true
  );
  assert.equal(
    byName.get("exit_service_rescue").inputSchema.properties
      ?.acknowledge_restart.const,
    true
  );

  const advertised = await client.callTool({
    name: "get_service_rescue",
    arguments: { orderNo: "VP123" },
  });
  assert.match(advertised.content[0].text, /ubuntu-24\.04/);

  const refused = await client.callTool({
    name: "enter_service_rescue",
    arguments: {
      orderNo: "VP123",
      image: "invented.iso",
      acknowledge_reboot: true,
      idempotencyKey: "rescue-enter-refused-0001",
    },
  });
  assert.equal(refused.isError, true);
  assert.equal(requests.filter(({ method }) => method === "POST").length, 0);

  await client.callTool({
    name: "enter_service_rescue",
    arguments: {
      orderNo: "VP123",
      image: "ubuntu-24.04",
      acknowledge_reboot: true,
      idempotencyKey: "rescue-enter-approved-0001",
    },
  });
  const enter = requests.find(({ method }) => method === "POST");
  assert.deepEqual(enter.body, {
    image: "ubuntu-24.04",
    acknowledgeReboot: true,
  });
  assert.equal(
    enter.headers["idempotency-key"],
    "rescue-enter-approved-0001"
  );

  await client.callTool({
    name: "exit_service_rescue",
    arguments: {
      orderNo: "VP123",
      rescue_session_id: SESSION_ID,
      acknowledge_restart: true,
      idempotencyKey: "rescue-exit-approved-0001",
    },
  });
  const exit = requests.find(({ method }) => method === "DELETE");
  assert.equal(exit.url, "/account/services/VP123/rescue");
  assert.equal(
    exit.headers["idempotency-key"],
    "rescue-exit-approved-0001"
  );
});
