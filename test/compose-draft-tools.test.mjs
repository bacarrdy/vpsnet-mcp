import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP does not expose portal-only free AI drafting", async (t) => {
  const client = new Client({ name: "free-ai-boundary", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    env: {
      ...process.env,
      VPSNET_API_KEY: "contract-test-key",
      VPSNET_API_URL: "http://127.0.0.1:9",
    },
  });
  await client.connect(transport);
  t.after(async () => client.close());

  const { tools } = await client.listTools();

  assert.equal(
    tools.some((tool) => tool.name === "draft_application_compose"),
    false
  );
});
