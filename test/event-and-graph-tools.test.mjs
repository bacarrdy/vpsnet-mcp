import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// qa-mcp-api-0930 M3/M4: get_service_graphs had no metric/period (the API
// answered invalidRequest), and nothing could follow an action's noty UUID.
test("graph, event and wait tools send what the API needs", async (t) => {
  const NOTY = "18401ea7-0c1d-4c7e-9a55-0123456789ab";
  const requests = [];
  let polls = 0;
  const api = createServer((req, res) => {
    requests.push(req.url);
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/account/services/VP1/graphs")) {
      res.end('{"success":true,"data":""}');
      return;
    }
    if (req.url === `/account/events/${NOTY}`) {
      polls += 1;
      res.end(JSON.stringify({ payload: null, state: polls < 2 ? "proccessing" : "completed", message: null, id: 7 }));
      return;
    }
    if (req.url === "/account/events/2071236") {
      res.end('{"payload":null,"state":"completed","message":null,"id":2071236}');
      return;
    }
    res.statusCode = 404;
    res.end('{"payload":null}');
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    api.closeAllConnections();
    await new Promise((resolve) => api.close(resolve));
  });

  const client = new Client({ name: "event-graph-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    env: {
      ...process.env,
      VPSNET_API_KEY: "contract-test-key",
      VPSNET_API_URL: `http://127.0.0.1:${api.address().port}`,
    },
  });
  await client.connect(transport);
  t.after(async () => client.close());

  await client.callTool({
    name: "get_service_graphs",
    arguments: { orderNo: "VP1", metric: "net", period: "1d", fields: ["rx", "tx"] },
  });
  assert.equal(requests.at(-1), "/account/services/VP1/graphs?m=net&p=1d&f=rx%2Ctx");

  const missing = await client.callTool({ name: "get_service_graphs", arguments: { orderNo: "VP1" } });
  assert.equal(missing.isError, true);

  const numeric = await client.callTool({ name: "get_event", arguments: { id: 2071236 } });
  assert.equal(JSON.parse(numeric.content[0].text).state, "completed");

  const waited = await client.callTool({ name: "wait_for_event", arguments: { id: NOTY, timeout_seconds: 30 } });
  const body = JSON.parse(waited.content[0].text);
  assert.equal(body.state, "completed");
  assert.equal(body.timed_out, false);
  assert.equal(polls, 2);

  const refused = await client.callTool({ name: "get_event", arguments: { id: "../../account/api-keys" } });
  assert.equal(refused.isError, true);
});
