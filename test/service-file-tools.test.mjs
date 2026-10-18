import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.VPSNET_API_KEY ||= "vpsnet_" + "x".repeat(43);
const { serviceFileTools, settleOperation, trustedTransferUrl, availabilityHint } = await import("../build/service-files.js");

const OP = "a".repeat(32);
const UPLOAD = "b".repeat(32);
const tool = name => { const found = serviceFileTools.find(t => t.name === name); assert.ok(found, name); return found; };
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const json = res => JSON.parse(res.content[0].text);

/** Mocked apiRequest / apiRawRequest / fetch with a virtual clock; answers come from `routes` in order. */
function mock(routes, { fetchRoutes = [] } = {}) {
  const calls = [];
  let clock = 0;
  const next = (list, key, call) => {
    const index = list.findIndex(([match]) => (typeof match === "string" ? key === match : match.test(key)));
    assert.notEqual(index, -1, `unexpected call ${key}`);
    const [, answer, keep] = list[index];
    if (!keep) list.splice(index, 1);
    return typeof answer === "function" ? answer(call) : answer;
  };
  const deps = {
    request: async (method, path, body, headers) => {
      const call = { kind: "api", method, path, body, headers };
      calls.push(call);
      return next(routes, `${method} ${path}`, call);
    },
    rawRequest: async (method, path, bytes, headers) => {
      const call = { kind: "raw", method, path, bytes: Buffer.from(bytes), headers };
      calls.push(call);
      return next(routes, `RAW ${method} ${path}`, call);
    },
    fetch: async (url, init) => {
      const call = { kind: "fetch", url: String(url), init };
      calls.push(call);
      const answer = next(fetchRoutes, `${init.method} ${String(url)}`, call);
      return answer instanceof Response ? answer : new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
    },
    sleep: async ms => { clock += ms; },
    now: () => clock,
  };
  return { deps, calls };
}

test("every file tool is registered with its explicit files scope, availability note and honest hints", () => {
  const names = serviceFileTools.map(t => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of ["get_service_file_capabilities", "list_service_files", "stat_service_file", "read_service_file", "search_service_files",
    "get_service_file_download_url", "download_service_file", "get_service_file_operation", "create_service_directory", "move_service_file",
    "delete_service_files", "write_service_file", "upload_service_file", "list_service_file_uploads", "abort_service_file_upload", "extract_service_file_archive"]) {
    const t = tool(name);
    assert.match(t.description, /agent_update_required/, name);
    assert.match(t.description, /VDS file-manager switch/, name);
    assert.match(t.description, t.scope === "files:read" ? /files:read/ : /files:manage/, name);
    assert.ok(!(t.annotations.readOnlyHint && t.annotations.destructiveHint), name);
  }
  for (const name of ["delete_service_files", "move_service_file", "write_service_file", "upload_service_file"]) {
    assert.equal(tool(name).scope, "files:manage");
    assert.equal(tool(name).annotations.destructiveHint, true, name);
  }
  assert.equal(tool("get_service_file_download_url").annotations.readOnlyHint, false, "minting a token is a persisted credential");
  assert.throws(() => tool("delete_service_files").schema.parse({ orderNo: "VP1", paths: ["/tmp/x"] }), /confirm/);
  assert.throws(() => tool("list_service_files").schema.parse({ orderNo: "VP1/../x" }));
  assert.throws(() => tool("stat_service_file").schema.parse({ orderNo: "VP1", path: "relative" }));
  assert.throws(() => tool("upload_service_file").schema.parse({ orderNo: "VP1", path: "/x", localPath: "relative/file" }));
});

test("capabilities surface the unavailable reason verbatim with its meaning", async () => {
  const { deps, calls } = mock([["GET /account/services/VP1/files/capabilities", { status: 200, data: { success: true, available: false, platform: "firecracker", reason: "agent_update_required", features: {}, limits: {}, transfer: {} } }]]);
  const res = await tool("get_service_file_capabilities").run({ orderNo: "VP1" }, deps);
  assert.equal(calls.length, 1);
  assert.equal(json(res).reason, "agent_update_required");
  assert.match(res.content[1].text, /reason=agent_update_required \(verbatim/);
  assert.match(res.content[1].text, /guest agent must be updated/);
  assert.equal(availabilityHint({ success: false, filesUnavailable: true, reason: "feature_disabled", http_status: 409 })?.includes("VDS"), true);
  assert.equal(availabilityHint({ success: true, available: true, reason: null }), null);
});

test("reads send exactly the documented query and a 409 unavailable answer is an error with the reason", async () => {
  const { deps, calls } = mock([
    [/^GET \/account\/services\/VP1\/files\/list\?/, { status: 200, data: { success: true, entries: [], nextOffset: null } }],
    [/^GET \/account\/services\/VP1\/files\/stat\?/, { status: 409, data: { success: false, filesUnavailable: true, reason: "feature_disabled", http_status: 409 } }],
    [/^GET \/account\/services\/VP1\/files\/search\?/, { status: 200, data: { success: true, results: [] } }],
  ]);
  await tool("list_service_files").run({ orderNo: "VP1", path: "/etc", limit: 50, sort: "mtime", order: "desc", filter: "conf" }, deps);
  assert.equal(calls[0].path, "/account/services/VP1/files/list?path=%2Fetc&limit=50&sort=mtime&order=desc&filter=conf");
  const stat = await tool("stat_service_file").run({ orderNo: "VP1", path: "/etc/hosts", hash: true, follow: false }, deps);
  assert.equal(calls[1].path, "/account/services/VP1/files/stat?path=%2Fetc%2Fhosts&hash=1&follow=0");
  assert.equal(stat.isError, true);
  assert.match(stat.content[1].text, /reason=feature_disabled/);
  await tool("search_service_files").run({ orderNo: "VP1", name: "*.log" }, deps);
  assert.equal(calls[2].path, "/account/services/VP1/files/search?name=*.log");
});

test("a 202 answer is polled inside the tool until the operation succeeds", async () => {
  const { deps, calls } = mock([
    [/^GET \/account\/services\/VP1\/files\/content\?/, { status: 202, data: { success: true, operationId: OP, state: "pending" } }],
    [`GET /account/services/VP1/files/operations/${OP}`, { status: 200, data: { success: true, operationId: OP, state: "running", progress: {}, result: null, errorCode: null } }],
    [`GET /account/services/VP1/files/operations/${OP}`, { status: 200, data: { success: true, operationId: OP, state: "succeeded", progress: {}, result: { kind: "text", encoding: "utf-8", data: "hello\n", sha256: "c".repeat(64), version: "v1:1" }, errorCode: null } }],
  ]);
  const res = await tool("read_service_file").run({ orderNo: "VP1", path: "/etc/motd" }, deps);
  assert.equal(res.isError, undefined);
  const body = json(res);
  assert.equal(body.data, "hello\n");
  assert.equal(body.operationId, OP);
  assert.equal(calls.filter(c => c.path.includes("/operations/")).length, 2);
});

test("a slow operation past waitSeconds returns its id and the follow-up read, failed and needsAttention are errors", async () => {
  const running = { status: 200, data: { success: true, operationId: OP, state: "running", progress: { entries: 7 }, result: null, errorCode: null } };
  const { deps } = mock([
    ["POST /account/services/VP1/files/delete", { status: 202, data: { success: true, operationId: OP, state: "running" } }],
    [`GET /account/services/VP1/files/operations/${OP}`, running, true],
  ]);
  const res = await tool("delete_service_files").run({ orderNo: "VP1", paths: ["/srv/old"], recursive: true, confirm: true, waitSeconds: 5 }, deps);
  const body = json(res);
  assert.equal(body.pending, true);
  assert.deepEqual(body.next_check, { tool: "get_service_file_operation", arguments: { orderNo: "VP1", operationId: OP } });
  assert.equal(res.isError, undefined);

  for (const [state, error] of [["failed", "filesBusy"], ["needsAttention", "outcome_unknown"]]) {
    const { deps: d } = mock([[`GET /account/services/VP1/files/operations/${OP}`, { status: 200, data: { success: true, operationId: OP, state, result: null, errorCode: "filesBusy" } }]]);
    const settled = await settleOperation(d, "VP1", { status: 202, data: { operationId: OP, state: "pending" } }, 10_000);
    assert.equal(settled.data.success, false, state);
    assert.equal(settled.data.error, error, state);
  }
  const { deps: none, calls } = mock([]);
  const immediate = await settleOperation(none, "VP1", { status: 202, data: { operationId: OP, state: "pending" } }, 0);
  assert.equal(immediate.data.pending, true);
  assert.equal(calls.length, 0);
});

test("mutations send the documented bodies, confirm flags and preconditions", async () => {
  const ok = { status: 200, data: { success: true, entry: {} } };
  const { deps, calls } = mock([
    ["POST /account/services/VP1/files/mkdir", ok], ["POST /account/services/VP1/files/move", ok],
    ["POST /account/services/VP1/files/write", { status: 200, data: { success: true, sha256: "d".repeat(64), version: "v1:2", created: false } }],
    ["POST /account/services/VP1/files/extract", { status: 202, data: { success: true, operationId: OP, state: "running" } }],
    [`GET /account/services/VP1/files/operations/${OP}`, { status: 200, data: { success: true, operationId: OP, state: "succeeded", result: { archive: "/srv/a.zip", destination: "/srv/a", entries: 3 }, errorCode: null } }],
    [`DELETE /account/services/VP1/files/uploads/${UPLOAD}`, { status: 200, data: { success: true, upload: { id: UPLOAD, state: "aborted" } } }],
  ]);
  await tool("create_service_directory").run({ orderNo: "VP1", path: "/srv/new", parents: true }, deps);
  assert.deepEqual(calls[0].body, { path: "/srv/new", parents: true });
  await tool("move_service_file").run({ orderNo: "VP1", from: "/srv/a", to: "/srv/b", confirm: true }, deps);
  assert.deepEqual(calls[1].body, { from: "/srv/a", to: "/srv/b", confirm: true });
  assert.equal((await tool("write_service_file").run({ orderNo: "VP1", path: "/srv/x", content: "x" }, deps)).isError, true, "a precondition is required");
  assert.equal((await tool("write_service_file").run({ orderNo: "VP1", path: "/srv/x", content: "x", createOnly: true, expectedVersion: "v1" }, deps)).isError, true, "only one precondition");
  await tool("write_service_file").run({ orderNo: "VP1", path: "/srv/x", content: "héllo", expectedSha256: "E".repeat(64) }, deps);
  assert.deepEqual(calls[2].body, { path: "/srv/x", contentBase64: Buffer.from("héllo").toString("base64"), expectedSha256: "e".repeat(64) });
  const extracted = await tool("extract_service_file_archive").run({ orderNo: "VP1", archive: "/srv/a.zip" }, deps);
  assert.equal(json(extracted).entries, 3);
  await tool("abort_service_file_upload").run({ orderNo: "VP1", uploadId: UPLOAD }, deps);
  assert.equal(calls.at(-1).method, "DELETE");
});

test("upload (Cloud VPS) creates, sends every chunk to the API chunk route, commits through a 202 and checks the SHA-256", async () => {
  const content = Buffer.from("0123456789abcdefXYZ");
  const digest = sha(content);
  const { deps, calls } = mock([
    ["POST /account/services/VP1/files/uploads", call => {
      assert.deepEqual(call.body, { path: "/srv/data.bin", size: content.length, sha256: digest, mode: "0640" });
      return { status: 201, data: { success: true, upload: { id: UPLOAD, size: content.length, received: 0, chunkSize: 8, state: "uploading",
        transfer: { method: "PUT", auth: "session", url: `https://evil.example/account/services/VP1/files/uploads/${UPLOAD}/chunk` } } } };
    }],
    [`RAW PUT /account/services/VP1/files/uploads/${UPLOAD}/chunk`, { status: 200, data: { success: true, received: 8, complete: false } }],
    [`RAW PUT /account/services/VP1/files/uploads/${UPLOAD}/chunk`, { status: 503, data: { success: false, http_status: 503 } }],
    [`RAW PUT /account/services/VP1/files/uploads/${UPLOAD}/chunk`, { status: 200, data: { success: true, received: 16, complete: false } }],
    [`RAW PUT /account/services/VP1/files/uploads/${UPLOAD}/chunk`, { status: 200, data: { success: true, received: 19, complete: true } }],
    [`POST /account/services/VP1/files/uploads/${UPLOAD}/complete`, { status: 202, data: { success: true, operationId: OP, state: "pending" } }],
    [`GET /account/services/VP1/files/operations/${OP}`, { status: 200, data: { success: true, operationId: OP, state: "succeeded", result: { path: "/srv/data.bin", size: 19, sha256: digest, version: "v1:9", created: true }, errorCode: null } }],
  ]);
  const res = await tool("upload_service_file").run({ orderNo: "VP1", path: "/srv/data.bin", contentBase64: content.toString("base64"), mode: "0640" }, deps);
  assert.equal(res.isError, undefined, res.content[0].text);
  const body = json(res);
  assert.equal(body.sha256, digest);
  assert.equal(body.created, true);
  const chunks = calls.filter(c => c.kind === "raw");
  assert.deepEqual(chunks.map(c => c.headers["Content-Range"]), ["bytes 0-7/19", "bytes 8-15/19", "bytes 8-15/19", "bytes 16-18/19"]);
  for (const c of chunks) assert.equal(c.headers["X-Chunk-Sha256"], sha(c.bytes));
  assert.equal(Buffer.concat([chunks[0].bytes, chunks[2].bytes, chunks[3].bytes]).toString(), content.toString());
  assert.equal(calls.some(c => c.kind === "fetch"), false, "the session URL host is never contacted directly");
});

test("upload (Firecracker) sends chunks to the data plane without the API key, refreshes an expired URL and resumes after an out-of-order answer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vpsnet-upload-"));
  try {
    const file = join(dir, "site.tar");
    const content = Buffer.alloc(10, 7);
    writeFileSync(file, content);
    const url1 = `https://novnc.vpsnet.com/fc-files/upload?host=node1&token=${"t".repeat(43)}`;
    const url2 = `https://novnc.vpsnet.com/fc-files/upload?host=node1&token=${"u".repeat(43)}`;
    const { deps, calls } = mock([
      ["POST /account/services/FC1/files/uploads", { status: 201, data: { success: true, upload: { id: UPLOAD, size: 10, received: 0, chunkSize: 4, state: "uploading", transfer: { method: "PUT", auth: "token", url: url1 } } } }],
      [`GET /account/services/FC1/files/uploads/${UPLOAD}`, { status: 200, data: { success: true, upload: { id: UPLOAD, size: 10, received: 4, chunkSize: 4, state: "uploading", transfer: { method: "PUT", auth: "token", url: url2 } } } }],
      [`POST /account/services/FC1/files/uploads/${UPLOAD}/complete`, { status: 200, data: { success: true, path: "/srv/site.tar", size: 10, sha256: sha(content), version: "v1:3", created: true } }],
    ], { fetchRoutes: [
      [`PUT ${url1}`, { status: 200, body: { success: true, received: 4, complete: false } }],
      [`PUT ${url1}`, { status: 403, body: { success: false, filesTransferRefused: true } }],
      [`PUT ${url2}`, { status: 409, body: { success: false, filesChunkOutOfOrder: true, received: 8 } }],
      [`PUT ${url2}`, { status: 200, body: { success: true, received: 10, complete: true } }],
    ] });
    const res = await tool("upload_service_file").run({ orderNo: "FC1", path: "/srv/site.tar", localPath: file }, deps);
    assert.equal(res.isError, undefined, res.content[0].text);
    const puts = calls.filter(c => c.kind === "fetch");
    assert.deepEqual(puts.map(c => c.init.headers["Content-Range"]), ["bytes 0-3/10", "bytes 4-7/10", "bytes 4-7/10", "bytes 8-9/10"]);
    for (const put of puts) {
      assert.equal(put.init.redirect, "error");
      assert.equal(Object.keys(put.init.headers).some(h => /api-key|authorization/i.test(h)), false);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a refused chunk aborts the upload; overwrite needs expectedVersion; untrusted data-plane hosts are never contacted", async () => {
  const { deps, calls } = mock([
    ["POST /account/services/VP1/files/uploads", { status: 201, data: { success: true, upload: { id: UPLOAD, size: 3, received: 0, chunkSize: 4, state: "uploading", transfer: { auth: "token", url: "https://evil.example/upload" } } } }],
    [`DELETE /account/services/VP1/files/uploads/${UPLOAD}`, { status: 200, data: { success: true } }],
  ]);
  const res = await tool("upload_service_file").run({ orderNo: "VP1", path: "/srv/x", contentBase64: Buffer.from("abc").toString("base64") }, deps);
  assert.equal(res.isError, true);
  assert.equal(json(res).uploadAborted, true);
  assert.equal(calls.some(c => c.kind === "fetch"), false);
  const overwrite = await tool("upload_service_file").run({ orderNo: "VP1", path: "/srv/x", contentBase64: "YQ==", overwrite: true }, mock([]).deps);
  assert.match(json(overwrite).error, /expectedVersion/);
  assert.equal(trustedTransferUrl("http://novnc.vpsnet.com/x"), null);
  assert.equal(trustedTransferUrl("https://vpsnet.com.evil.example/x"), null);
  assert.ok(trustedTransferUrl("https://www.vpsnet.com/files-download/abc"));
});

test("download mints a URL, fetches it without the API key and writes the file atomically; an existing file needs overwrite", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vpsnet-download-"));
  try {
    const target = join(dir, "nested", "backup.sql");
    const content = Buffer.from("SELECT 1;\n".repeat(100));
    const url = `https://www.vpsnet.com/files-download/${"k".repeat(43)}`;
    const answers = () => [[/^GET \/account\/services\/VP1\/files\/download-url\?path=%2Froot%2Fbackup\.sql$/, { status: 200, data: { success: true, url, expiresAt: "2026-10-18T12:00:00Z", size: content.length, version: "v1:5", filename: "backup.sql" } }]];
    const { deps, calls } = mock(answers(), { fetchRoutes: [[`GET ${url}`, () => new Response(content, { status: 200 })]] });
    const res = await tool("download_service_file").run({ orderNo: "VP1", path: "/root/backup.sql", localPath: target }, deps);
    assert.equal(res.isError, undefined, res.content[0].text);
    assert.equal(json(res).sha256, sha(content));
    assert.deepEqual(readFileSync(target), content);
    const fetched = calls.find(c => c.kind === "fetch");
    assert.equal(Object.keys(fetched.init.headers).some(h => /api-key|authorization/i.test(h)), false);

    const { deps: again, calls: none } = mock(answers());
    const refused = await tool("download_service_file").run({ orderNo: "VP1", path: "/root/backup.sql", localPath: target }, again);
    assert.equal(refused.isError, true);
    assert.equal(none.length, 0, "no token is minted for a refused local target");

    const short = mock(answers(), { fetchRoutes: [[`GET ${url}`, () => new Response(content.subarray(0, 10), { status: 200 })]] });
    const other = join(dir, "short.sql");
    const truncated = await tool("download_service_file").run({ orderNo: "VP1", path: "/root/backup.sql", localPath: other }, short.deps);
    assert.equal(truncated.isError, true);
    assert.equal(existsSync(other), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an image is returned as MCP image content, not as a base64 text blob", async () => {
  const { deps } = mock([[/^GET \/account\/services\/VP1\/files\/content\?/, { status: 200, data: { success: true, kind: "image", mime: "image/png", encoding: "base64", data: "iVBORw0KGgo=", size: 8, sha256: null, version: "v1", partial: false } }]]);
  const res = await tool("read_service_file").run({ orderNo: "VP1", path: "/srv/logo.png" }, deps);
  assert.equal(json(res).data, undefined);
  assert.deepEqual(res.content.at(-1), { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" });
});

test("end to end over stdio: the chunk route gets the raw bytes with X-API-KEY on the configured API base", async t => {
  const { createServer } = await import("node:http");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const requests = [];
  const content = Buffer.from("hello world");
  const api = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    requests.push({ method: req.method, url: req.url, headers: req.headers, raw });
    res.setHeader("content-type", "application/json");
    if (req.url === "/account/services/VP7/files/uploads") {
      res.statusCode = 201;
      return res.end(JSON.stringify({ success: true, upload: { id: UPLOAD, size: content.length, received: 0, chunkSize: 262144, state: "uploading", transfer: { method: "PUT", auth: "session", url: "https://api.vpsnet.com/ignored" } } }));
    }
    if (req.url.endsWith("/chunk")) return res.end(JSON.stringify({ success: true, received: raw.length, complete: true }));
    return res.end(JSON.stringify({ success: true, path: "/srv/hello.txt", size: content.length, sha256: sha(content), version: "v1:1", created: true }));
  });
  await new Promise(resolve => api.listen(0, "127.0.0.1", resolve));
  t.after(async () => { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); });
  const client = new Client({ name: "service-files-e2e", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["build/index.js"],
    env: { PATH: process.env.PATH, VPSNET_API_KEY: "contract-test-key", VPSNET_API_URL: `http://127.0.0.1:${api.address().port}` } }));
  t.after(() => client.close());
  const result = await client.callTool({ name: "upload_service_file", arguments: { orderNo: "VP7", path: "/srv/hello.txt", contentBase64: content.toString("base64") } });
  assert.equal(result.isError, undefined, result.content[0].text);
  const chunk = requests.find(r => r.url.endsWith("/chunk"));
  assert.equal(chunk.method, "PUT");
  assert.equal(chunk.url, `/account/services/VP7/files/uploads/${UPLOAD}/chunk`);
  assert.equal(chunk.headers["x-api-key"], "contract-test-key");
  assert.equal(chunk.headers["content-type"], "application/octet-stream");
  assert.equal(chunk.headers["content-range"], `bytes 0-10/${content.length}`);
  assert.deepEqual(chunk.raw, content);
  assert.equal(requests.at(-1).url, `/account/services/VP7/files/uploads/${UPLOAD}/complete`);
});

test("the hosted connector advertises the API-only file tools under vm:files scopes and never the local-path ones", async () => {
  const { discoverTools } = await import("../scripts/tool-contracts.mjs");
  const tools = await discoverTools({ remoteScopes: ["services:read"], remoteProfile: "directory" });
  const byName = new Map(tools.map(item => [item.name, item]));
  for (const name of ["download_service_file", "upload_service_file", "get_service_file_download_url"]) assert.equal(byName.has(name), false, name);
  assert.deepEqual(byName.get("list_service_files").securitySchemes, [{ type: "oauth2", scopes: ["vm:files:read"] }]);
  assert.equal(byName.get("list_service_files").annotations.readOnlyHint, true);
  assert.deepEqual(byName.get("delete_service_files").securitySchemes, [{ type: "oauth2", scopes: ["vm:files:write"] }]);
  assert.equal(byName.get("delete_service_files").annotations.destructiveHint, true);
  const local = await discoverTools({});
  assert.ok(local.some(item => item.name === "upload_service_file"));
});
