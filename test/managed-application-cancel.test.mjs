import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const INSTALLATION_ID = "b7ea0c2a-e6e4-4c25-87ca-c0cdf7e4ca42";
const ACTION_ID = "1f3502fc-1177-4e3f-b867-b3f6d7b9846e";
const OTHER_ACTION_ID = "935d7a11-e755-4da6-9194-2c065a2b69ce";

async function startApi(latestAction) {
  const requests = [];
  const api = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: body ? JSON.parse(body) : null,
    });

    res.setHeader("content-type", "application/json");
    if (req.method === "GET") {
      res.end(JSON.stringify({
        success: true,
        installation: {
          id: INSTALLATION_ID,
          ...(latestAction === undefined ? {} : { latest_action: latestAction }),
        },
      }));
      return;
    }

    res.statusCode = 202;
    res.end(JSON.stringify({
      success: true,
      installation: { id: INSTALLATION_ID, state: "ready" },
      action: { id: ACTION_ID, type: "install", state: "cancelled" },
    }));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  const address = api.address();
  return { api, requests, url: `http://127.0.0.1:${address.port}` };
}

async function connectClient(t, apiUrl) {
  const client = new Client({ name: "managed-cancel-contract", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    env: {
      ...process.env,
      VPSNET_API_KEY: "contract-test-key",
      VPSNET_API_URL: apiUrl,
    },
  });
  await client.connect(transport);
  t.after(async () => client.close());
  return client;
}

test("application action cancellation pre-reads and posts the exact typed request", async (t) => {
  const { api, requests, url } = await startApi({
    id: ACTION_ID,
    state: "queued",
    cancellable: true,
  });
  t.after(() => api.close());
  const client = await connectClient(t, url);

  const result = await client.callTool({
    name: "cancel_application_action",
    arguments: {
      orderNo: "VP123",
      installation_id: INSTALLATION_ID,
      action_id: ACTION_ID,
      idempotencyKey: "cancel-contract-key-0001",
    },
  });

  const installationPath =
    `/account/services/VP123/applications/installations/${INSTALLATION_ID}`;
  assert.equal(result.isError, undefined);
  assert.equal(requests.length, 2);
  assert.deepEqual(
    requests.map(({ method, url: requestUrl }) => ({ method, url: requestUrl })),
    [
      { method: "GET", url: installationPath },
      { method: "POST", url: `${installationPath}/actions/${ACTION_ID}/cancel` },
    ]
  );
  assert.deepEqual(requests[1].body, {});
  assert.equal(requests[1].headers["idempotency-key"], "cancel-contract-key-0001");
});

const refusalCases = [
  {
    name: "stale action when no latest action is advertised",
    latestAction: undefined,
    actionId: ACTION_ID,
  },
  {
    name: "wrong action when a different latest action is advertised",
    latestAction: { id: OTHER_ACTION_ID, state: "queued", cancellable: true },
    actionId: ACTION_ID,
  },
  {
    name: "non-cancellable latest action",
    latestAction: { id: ACTION_ID, state: "dispatched", cancellable: false },
    actionId: ACTION_ID,
  },
];

for (const { name, latestAction, actionId } of refusalCases) {
  test(`application action cancellation refuses ${name} before POST`, async (t) => {
    const { api, requests, url } = await startApi(latestAction);
    t.after(() => api.close());
    const client = await connectClient(t, url);

    const result = await client.callTool({
      name: "cancel_application_action",
      arguments: {
        orderNo: "VP123",
        installation_id: INSTALLATION_ID,
        action_id: actionId,
        idempotencyKey: `cancel-refusal-${requests.length}-${actionId}`,
      },
    });

    assert.equal(result.isError, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "GET");
    assert.match(
      result.content[0].text,
      /applicationActionCancellationNotAdvertised/
    );
  });
}
