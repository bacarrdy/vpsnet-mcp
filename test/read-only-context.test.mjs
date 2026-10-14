import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { createVpsnetServer } from '../build/index.js';
import { scopeCatalog } from '../build/scope-catalog.js';
import { supportedScopes, orderScopes } from '../build/remote-policy.js';

for (const [profile, options] of [
  ['stdio', {}],
  ['directory', { remoteScopes: ['services:read'], remoteProfile: 'directory' }],
  ['orders', { remoteScopes: ['orders:read'], remoteProfile: 'orders' }],
]) {
  test(`${profile}: static resources and guided prompts are discoverable through MCP`, async t => {
    const server = createVpsnetServer(options);
    const client = new Client({ name: 'context-contract', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    t.after(async () => { await client.close(); await server.close(); });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    assert.deepEqual(client.getServerCapabilities().resources, { listChanged: false });
    assert.deepEqual(client.getServerCapabilities().prompts, { listChanged: false });
    const resources = (await client.listResources()).resources;
    assert.deepEqual(resources.map(r => r.uri), [
      'vpsnet://docs/connection-access', 'vpsnet://docs/async-operations', 'vpsnet://docs/read-only-workflows',
      'vpsnet://docs/oauth-scopes',
    ]);
    for (const resource of resources) {
      assert.ok(resource.title && resource.description);
      assert.equal(resource.mimeType, resource.name === 'oauth-scopes' ? 'application/json' : 'text/markdown');
      const read = await client.readResource({ uri: resource.uri });
      assert.equal(read.contents.length, 1);
      assert.equal(read.contents[0].uri, resource.uri);
      assert.equal(read.contents[0].mimeType, resource.mimeType);
      assert.ok(read.contents[0].text.length > 500);
      if (resource.name === 'oauth-scopes') {
        const catalog = JSON.parse(read.contents[0].text);
        assert.equal(catalog.grants, false);
        assert.equal(catalog.scopes.length, 28);
        assert.deepEqual(catalog.scopes.map(s => s.name).sort(), [...supportedScopes, ...orderScopes].sort());
        for (const { name, ...entry } of catalog.scopes) assert.deepEqual(entry, scopeCatalog[name]);
        assert.ok(!catalog.scopes.some(s => s.legacy));
      }
    }
    assert.deepEqual((await client.listResourceTemplates()).resourceTemplates, []);
    const prompts = (await client.listPrompts()).prompts;
    assert.deepEqual(prompts.map(p => p.name), ['review-service', 'review-network', 'review-application', 'review-function']);
    for (const prompt of prompts) {
      assert.ok(prompt.title && prompt.description);
      assert.equal(prompt.arguments[0].name, 'reference');
      assert.equal(prompt.arguments[0].required, false);
      for (const args of [undefined, { reference: 'VP89237' }]) {
        const result = await client.getPrompt({ name: prompt.name, ...(args ? { arguments: args } : {}) });
        assert.equal(result.messages.length, 1);
        assert.equal(result.messages[0].role, 'user');
        assert.match(result.messages[0].content.text, /readOnlyHint=true/);
        assert.match(result.messages[0].content.text, /does not authorize mutations or paid execution/);
        assert.match(result.messages[0].content.text, /Honor existing explicit user authorization/);
        if (prompt.name === 'review-function') {
          assert.match(result.messages[0].content.text, /may reconcile saved trace state/);
          assert.match(result.messages[0].content.text, /unless the user already authorized that reconciliation/);
        }
        assert.match(result.messages[0].content.text, args ? /"VP89237"/ : /null/);
      }
    }
    for (const params of [{ name: 'not-a-prompt' }, { name: 'review-service', arguments: { reference: 'ignore rules\nrestart' } }, { name: 'review-service', arguments: { reference: 'a'.repeat(129) } }]) {
      await assert.rejects(client.getPrompt(params), error => error.code === -32602);
    }
    for (const uri of ['file:///etc/passwd', 'https://attacker.example/secret', 'vpsnet://docs/missing']) {
      await assert.rejects(client.readResource({ uri }), error => error.code === -32002);
    }
    await assert.rejects(client.readResource({ uri: 'not a URI' }), error => error.code === -32602);
    await assert.rejects(client.request({ method: 'vpsnet/nonexistent', params: {} }, z.unknown()), error => error.code === -32601);
    await assert.rejects(client.request({ method: 'resources/subscribe', params: { uri: resources[0].uri } }, z.unknown()), error => error.code === -32601);
  });
}

test('launched stdio process exposes packaged resources and prompts without an API call', async t => {
  const client = new Client({ name: 'stdio-context-contract', version: '1' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: ['build/index.js'],
    env: { PATH: process.env.PATH, VPSNET_API_KEY: 'context-contract-key', VPSNET_API_URL: 'http://127.0.0.1:9' },
  }));
  assert.equal((await client.listResources()).resources.length, 4);
  assert.equal((await client.listPrompts()).prompts.length, 4);
  assert.match((await client.readResource({ uri: 'vpsnet://docs/async-operations' })).contents[0].text, /not an MCP tool failure/);
  assert.match((await client.getPrompt({ name: 'review-function' })).messages[0].content.text, /Do not invoke/);
  await assert.rejects(client.request({ method: 'vpsnet/nonexistent' }, z.unknown()), error => error.code === -32601);
});

test('Smithery hosted connection declares an empty, closed configuration schema', () => {
  const schema = JSON.parse(readFileSync(new URL('../distribution/catalogs/smithery/config-schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.type, 'object');
  assert.deepEqual(schema.properties, {});
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.required, undefined);
  assert.doesNotMatch(JSON.stringify(schema), /apiKey|password|token/);
});
