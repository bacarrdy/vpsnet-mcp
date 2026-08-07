import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DRAFT_PATH =
  "/account/services/VP123/applications/custom-projects/ai/draft";

async function withServer(t, respond) {
  const requests = [];
  const api = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      method: req.method,
      url: req.url,
      body: body ? JSON.parse(body) : null,
    });

    const { status, response } = respond(req);
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(response));
  });
  await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
  t.after(() => api.close());

  const client = new Client({ name: "compose-draft", version: "1.0.0" });
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

  return { client, requests };
}

test("a draft is returned as an unvalidated suggestion", async (t) => {
  const { client, requests } = await withServer(t, (req) =>
    req.url === DRAFT_PATH
      ? {
          status: 200,
          response: {
            success: true,
            compose_yaml: "services:\n  web:\n    image: nginx:1.27\n",
            summary: "One nginx service.",
            notes: ["Pin the image tag.", "Data lives in a named volume."],
          },
        }
      : { status: 404, response: { notFound: true } }
  );

  const result = await client.callTool({
    name: "draft_application_compose",
    arguments: {
      orderNo: "VP123",
      description: "a small nginx web server",
    },
  });

  const sent = requests[0];
  assert.equal(sent.method, "POST");
  assert.equal(sent.url, DRAFT_PATH);
  // Only the backend's allow-listed keys; unknown keys are a 422 there.
  assert.deepEqual(sent.body, { description: "a small nginx web server" });

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.success, true);
  assert.match(payload.compose_yaml, /nginx:1\.27/);
  assert.equal(payload.notes.length, 2);
  assert.match(payload.next_step, /validate_application_recipe/);
  assert.match(payload.next_step, /not validated or installed/);
});

test("optional fields are forwarded only when supplied", async (t) => {
  const { client, requests } = await withServer(t, () => ({
    status: 200,
    response: {
      success: true,
      compose_yaml: "services: {}\n",
      summary: "",
      notes: [],
    },
  }));

  await client.callTool({
    name: "draft_application_compose",
    arguments: {
      orderNo: "VP123",
      description: "revise this",
      project_name: "my-stack",
      current_compose: "services:\n  old:\n    image: redis:7\n",
    },
  });

  assert.deepEqual(requests[0].body, {
    description: "revise this",
    project_name: "my-stack",
    current_compose: "services:\n  old:\n    image: redis:7\n",
  });
});

test("an unreachable assistant degrades to an honest unavailable result", async (t) => {
  const { client } = await withServer(t, () => ({
    status: 503,
    response: { success: false, unavailable: true },
  }));

  const result = await client.callTool({
    name: "draft_application_compose",
    arguments: { orderNo: "VP123", description: "anything" },
  });

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.success, false);
  assert.equal(payload.status, 503);
  assert.equal(payload.compose_yaml, undefined);
  assert.match(payload.reason, /unavailable right now/);
  assert.match(payload.fix, /validate_application_recipe/);
});

test("a rate-limited draft reports the retry interval", async (t) => {
  const { client } = await withServer(t, () => ({
    status: 429,
    response: { success: false, rateLimited: true, retryAfter: 1800 },
  }));

  const result = await client.callTool({
    name: "draft_application_compose",
    arguments: { orderNo: "VP123", description: "anything" },
  });

  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.success, false);
  assert.equal(payload.retry_after, 1800);
});

test("the draft surface never names an AI host or model provider", async (t) => {
  const { client } = await withServer(t, () => ({
    status: 503,
    response: { success: false, unavailable: true },
  }));

  const { tools } = await client.listTools();
  const draft = tools.find((tool) => tool.name === "draft_application_compose");
  const result = await client.callTool({
    name: "draft_application_compose",
    arguments: { orderNo: "VP123", description: "anything" },
  });

  const text = `${draft.description} ${draft.annotations?.title} ${result.content[0].text}`;
  assert.match(text, /VPSnet AI assistant/);
  assert.equal(/ai\.vpsnet/i.test(text), false);
  assert.equal(/openai|anthropic|claude|gpt-|gemini|mistral/i.test(text), false);
});
