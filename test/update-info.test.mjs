import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import Ajv from 'ajv';
import { z } from 'zod';
import { RELEASE_FEED_URL, MAX_FEED_BYTES, fetchPublishedFeed, parsePublishedFeed,
  validatePublishedFeed, getUpdateInfo, updateInfoOutput } from '../build/update-info.js';

const feed = JSON.parse(readFileSync(new URL('../distribution/releases/published.json', import.meta.url)));
const copy = () => structuredClone(feed);
const runtime = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;

test('public release validation rejects instructions, hostile URLs, prereleases and duplicate aliases', () => {
  assert.deepEqual(parsePublishedFeed(JSON.stringify(feed)), feed);
  for (const mutate of [d => { d.commands = ['curl bad | sh']; }, d => { d.plugin.release_body = 'touch bad'; },
    d => { d.plugin.url = 'https://127.0.0.1/'; }, d => { d.mcp.version = '2.3.15-beta'; },
    d => { d.plugin.ci_conclusion = 'failure'; }, d => { d.schema_version = true; }]) {
    const value = copy(); mutate(value); assert.throws(() => validatePublishedFeed(value));
  }
  assert.throws(() => parsePublishedFeed('{"schema_version":1,"schema_version":1}'), /Duplicate/);
  assert.throws(() => parsePublishedFeed(String.raw`{"schema_version":1,"\u0073chema_version":1}`), /Duplicate/);
});

test('fixed feed fetch refuses redirects, streams bounded bytes and aborts body reads', async t => {
  const result = await fetchPublishedFeed(async (url, options) => {
    assert.equal(url, RELEASE_FEED_URL); assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Accept, 'application/json');
    return new Response(JSON.stringify(feed));
  });
  assert.deepEqual(result, feed);
  await assert.rejects(fetchPublishedFeed(async () => new Response('', { status: 302 })));
  let cancelled = false;
  await assert.rejects(fetchPublishedFeed(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(MAX_FEED_BYTES)); controller.enqueue(new Uint8Array(1)); },
    cancel() { cancelled = true; },
  }))), /too large/);
  assert.equal(cancelled, true);
  const originalTimeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', milliseconds => { assert.equal(milliseconds, 5000); return originalTimeout(20); });
  const keepAlive = setTimeout(() => {}, 100);
  try {
    await assert.rejects(fetchPublishedFeed(async (_url, options) => new Response(new ReadableStream({
      start(controller) { options.signal.addEventListener('abort', () => controller.error(options.signal.reason)); },
    }))), /aborted|timeout/i);
  } finally { clearTimeout(keepAlive); }
});

test('only supplied installed versions compare; actual gateway runtime is independent', async () => {
  const unknown = await getUpdateInfo({ client: 'codex' }, async () => feed);
  assert.deepEqual(unknown.observed.plugin, { version: null, source: 'unknown' });
  assert.deepEqual(unknown.observed.local_mcp, { version: null, source: 'unknown' });
  assert.deepEqual(unknown.observed.server, { version: runtime, source: 'runtime' });
  assert.equal(unknown.update_available.plugin, null);
  assert.equal(unknown.distribution_status.remote_deployment_status, 'unknown');
  const old = await getUpdateInfo({ client: 'claude-code', pluginVersion: '0.0.1' }, async () => feed);
  assert.equal(old.update_available.plugin, true);
  assert.equal(old.observed.plugin.source, 'caller_reported');
  assert.equal(old.compatibility.status, 'unknown');
  assert.ok(old.instructions.steps.some(step => step.includes('claude plugin update')));
  const failed = await getUpdateInfo({ pluginVersion: '0.0.1' }, async () => { throw new Error('PRIVATE ERROR COMMAND'); });
  assert.equal(failed.update_available.plugin, null);
  assert.equal(failed.published, null);
  assert.ok(!JSON.stringify(failed).includes('PRIVATE ERROR'));
  assert.equal(failed.advisory, true);
  z.object(updateInfoOutput).parse(failed);
});

function rpc(port, method, params, authorization = true) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, method: 'POST', path: '/mcp', headers: {
      host: 'mcp.vpsnet.com', accept: 'application/json, text/event-stream', 'content-type': 'application/json',
      ...(authorization ? { authorization: 'Bearer vpsnet_' + 'a'.repeat(43) } : {}),
    } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject); req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
  });
}

test('HTTP update info requires authentication but no extra account scope and never calls customer APIs', async t => {
  const resource = 'https://mcp.vpsnet.com/mcp', issuer = 'https://api.vpsnet.com/oauth/mcp';
  const paths = [];
  const backend = createServer((req, res) => {
    paths.push(req.url); assert.equal(req.url, '/oauth/mcp/introspect');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ active: true, aud: resource, iss: issuer, exp: Date.now()/1000 + 300,
      sub: 'account', grant_id: 'grant', scope: '', services: [] }));
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  process.env.VPSNET_API_URL = `http://127.0.0.1:${backend.address().port}`;
  const originalFetch = globalThis.fetch;
  let publicFetches = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === RELEASE_FEED_URL) { publicFetches++; return new Response(JSON.stringify(feed)); }
    assert.ok(String(url).startsWith(process.env.VPSNET_API_URL));
    return originalFetch(url, options);
  });
  const { createRemoteServer } = await import('../build/http-server.js');
  const remote = createRemoteServer({ resource, issuer });
  remote.listen(0, '127.0.0.1'); await once(remote, 'listening');
  t.after(() => { remote.closeAllConnections(); remote.close(); backend.closeAllConnections(); backend.close(); });
  const port = remote.address().port;
  assert.equal((await rpc(port, 'tools/list', {}, false)).status, 401);
  const listing = await rpc(port, 'tools/list', {});
  assert.equal(listing.body.result.tools.length, 255);
  const tool = listing.body.result.tools.find(value => value.name === 'get_update_info');
  assert.ok(tool);
  assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: [] }]);
  assert.deepEqual(tool._meta.securitySchemes, tool.securitySchemes);
  assert.equal(tool.annotations.readOnlyHint, true); assert.equal(tool.annotations.destructiveHint, false);
  assert.equal(tool.annotations.idempotentHint, true); assert.equal(tool.annotations.openWorldHint, false);
  assert.ok(tool.outputSchema.required.includes('observed'));
  const ajv = new Ajv({ strict: false, validateFormats: false });
  const validate = ajv.compile(tool.outputSchema);
  for (let i = 0; i < 2; i++) {
    const call = await rpc(port, 'tools/call', { name: 'get_update_info', arguments: { client: 'codex', pluginVersion: '0.0.1' } });
    assert.notEqual(call.body.result.isError, true);
    assert.equal(validate(call.body.result.structuredContent), true, JSON.stringify(validate.errors));
    assert.equal(call.body.result.structuredContent.update_available.plugin, true);
  }
  assert.equal(publicFetches, 1, 'public cache bounds repeated fetches without tracking customers');
  assert.ok(paths.every(path => path === '/oauth/mcp/introspect'));
  assert.match(tool.description, /first VPSnet use.*conversation.*once/);
  assert.match(tool.description, /stay quiet unless/);
});
