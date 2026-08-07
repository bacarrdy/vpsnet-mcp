import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const BROWSE_ID = "550e8400-e29b-41d4-a716-446655440000";
const DIR_ENTRY = "a".repeat(64);

const browse = (state, result = null) => ({
  id: BROWSE_ID,
  backupPointId: 7,
  state,
  result,
  errorCode: null,
  createdAt: "2026-08-06 11:59:00",
  completedAt: state === "succeeded" ? "2026-08-06 12:00:00" : null,
  expiresAt: "2026-08-06 13:00:00",
});

async function withServer(t, { searchAvailable }) {
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

    let status = 200;
    let response;
    if (
      req.method === "GET"
      && req.url === "/account/services/VP123/restore/files/points"
    ) {
      response = {
        success: true,
        available: true,
        searchAvailable,
        points: [{
          id: 7,
          backupTime: "2026-08-06 03:00:00",
          expiresAt: "2026-08-20 03:00:00",
          retentionKind: "daily",
          consistencyLevel: "application",
          sizeBytes: 1024,
        }],
        activeRestore: null,
      };
    } else if (
      req.method === "POST"
      && req.url === "/account/services/VP123/restore/files/browses"
    ) {
      status = 202;
      response = { success: true, replayed: false, browse: browse("queued") };
    } else if (
      req.method === "GET"
      && req.url === `/account/services/VP123/restore/files/browses/${BROWSE_ID}`
    ) {
      response = {
        success: true,
        browse: browse("succeeded", {
          directory: { path: "/" },
          entries: [{
            id: DIR_ENTRY,
            name: "etc",
            type: "directory",
            size_bytes: 4096,
            modified_at: "2026-08-06 12:00:00",
          }],
          offset: 0,
          nextOffset: 200,
          truncated: true,
          scanned: 23,
        }),
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

  const client = new Client({ name: "file-restore", version: "1.0.0" });
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

test("browse tools are read-only and bind to the exact backup file routes", async (t) => {
  const { client, requests } = await withServer(t, { searchAvailable: true });

  const { tools } = await client.listTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  for (const name of [
    "list_restore_file_points",
    "browse_restore_files",
    "get_restore_file_browse",
  ]) {
    assert.equal(byName.get(name).annotations?.readOnlyHint, true, name);
    assert.equal(byName.get(name).annotations?.destructiveHint, false, name);
  }

  await client.callTool({
    name: "list_restore_file_points",
    arguments: { orderNo: "VP123" },
  });

  await client.callTool({
    name: "browse_restore_files",
    arguments: {
      orderNo: "VP123",
      backupPointId: 7,
      idempotencyKey: "browse-root-0001",
    },
  });

  const post = requests.find(({ method }) => method === "POST");
  assert.equal(post.url, "/account/services/VP123/restore/files/browses");
  assert.deepEqual(post.body, { backupPointId: 7, offset: 0 });
  assert.equal(post.headers["idempotency-key"], "browse-root-0001");

  const polled = await client.callTool({
    name: "get_restore_file_browse",
    arguments: { orderNo: "VP123", browse_id: BROWSE_ID },
  });
  const payload = JSON.parse(polled.content[0].text);
  assert.equal(payload.browse.state, "succeeded");
  assert.equal(payload.browse.result.entries[0].type, "directory");
  assert.equal(payload.browse.result.truncated, true);
  assert.equal(payload.browse.result.nextOffset, 200);
});

test("search is sent only when the node advertises the capability", async (t) => {
  const { client, requests } = await withServer(t, { searchAvailable: true });

  await client.callTool({
    name: "browse_restore_files",
    arguments: {
      orderNo: "VP123",
      backupPointId: 7,
      filter: "etc",
      idempotencyKey: "browse-search-0001",
    },
  });

  // The capability is probed first, then the filter is forwarded.
  assert.equal(
    requests.filter(({ url }) =>
      url === "/account/services/VP123/restore/files/points"
    ).length,
    1
  );
  const post = requests.find(({ method }) => method === "POST");
  assert.equal(post.body.filter, "etc");
});

test("an unsupported node fails the search instead of returning unfiltered files", async (t) => {
  const { client, requests } = await withServer(t, { searchAvailable: false });

  const refused = await client.callTool({
    name: "browse_restore_files",
    arguments: {
      orderNo: "VP123",
      backupPointId: 7,
      filter: "etc",
      idempotencyKey: "browse-search-refused-0001",
    },
  });

  assert.equal(refused.isError, true);
  const payload = JSON.parse(refused.content[0].text);
  assert.deepEqual(payload.error_codes, ["serviceFileBrowseSearchUnavailable"]);
  assert.match(payload.reason, /not available/);
  assert.match(payload.fix, /Do not treat an unfiltered listing as a search result/);

  // Nothing was queued: an unfiltered listing must never stand in for a search.
  assert.equal(requests.filter(({ method }) => method === "POST").length, 0);
});

test("plain browsing still works on a node without search", async (t) => {
  const { client, requests } = await withServer(t, { searchAvailable: false });

  await client.callTool({
    name: "browse_restore_files",
    arguments: {
      orderNo: "VP123",
      backupPointId: 7,
      idempotencyKey: "browse-nosearch-0001",
    },
  });

  const post = requests.find(({ method }) => method === "POST");
  assert.deepEqual(post.body, { backupPointId: 7, offset: 0 });
  assert.equal("filter" in post.body, false);
  // No capability probe is needed when no filter was requested.
  assert.equal(
    requests.filter(({ url }) =>
      url === "/account/services/VP123/restore/files/points"
    ).length,
    0
  );
});

test("paging into a directory sends the opaque entry id, never a path", async (t) => {
  const { client, requests } = await withServer(t, { searchAvailable: true });

  await client.callTool({
    name: "browse_restore_files",
    arguments: {
      orderNo: "VP123",
      backupPointId: 7,
      sourceBrowseId: BROWSE_ID,
      directoryEntryId: DIR_ENTRY,
      idempotencyKey: "browse-descend-0001",
    },
  });

  const post = requests.find(({ method }) => method === "POST");
  assert.deepEqual(post.body, {
    backupPointId: 7,
    offset: 0,
    sourceBrowseId: BROWSE_ID,
    directoryEntryId: DIR_ENTRY,
  });

  const rejected = await client.callTool({
    name: "browse_restore_files",
    arguments: {
      orderNo: "VP123",
      backupPointId: 7,
      directoryEntryId: DIR_ENTRY,
      idempotencyKey: "browse-invalid-0001",
    },
  });
  assert.equal(rejected.isError, true);
  assert.equal(requests.filter(({ method }) => method === "POST").length, 1);
});

test("no paid file-restore tool is exposed", async (t) => {
  const { client } = await withServer(t, { searchAvailable: true });
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);

  assert.equal(names.includes("quote_restore_files"), false);
  assert.equal(names.includes("restore_files"), false);
  assert.equal(names.includes("request_file_restore"), false);
});
