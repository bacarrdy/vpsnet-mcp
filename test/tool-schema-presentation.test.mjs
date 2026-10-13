import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createVpsnetServer } from '../build/index.js';
import { inlineToolInputSchema } from '../build/tool-schema.js';

async function catalogue(t, profile) {
  const options = profile === 'stdio' ? {} : { remoteProfile: profile,
    remoteScopes: ['services:read', 'services:manage', 'orders:read', 'orders:servers', 'orders:domains'] };
  const server = createVpsnetServer(options);
  const client = new Client({ name: 'schema-presentation', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); });
  return new Map((await client.listTools()).tools.map(tool => [tool.name, tool]));
}
function inspect(schema, path) {
  if (schema === null || typeof schema !== 'object') return;
  assert.equal(schema.$ref, undefined, `${path} remains a local reference`);
  if (schema.properties) for (const [name, property] of Object.entries(schema.properties)) {
    assert.ok(property.type || property.anyOf || property.oneOf || property.allOf,
      `${path}.${name} needs a type or composition`);
  }
  for (const [key, value] of Object.entries(schema)) {
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) value.forEach((item, i) => inspect(item, `${path}.${key}[${i}]`));
      else inspect(value, `${path}.${key}`);
    }
  }
}
for (const profile of ['stdio', 'directory', 'orders']) {
  test(`${profile} emitted tool inputs inline repeated types without weakening constraints`, async t => {
    const tools = await catalogue(t, profile);
    for (const tool of tools.values()) inspect(tool.inputSchema, tool.name);
    const ns = tools.get('set_guest_nameservers').inputSchema;
    assert.deepEqual(ns.required, ['orderNo', 'type']);
    assert.deepEqual(ns.properties.type.enum, ['own', 'custom']);
    for (const name of ['ns1', 'ns2', 'ns3', 'ns4']) {
      assert.equal(ns.properties[name].type, 'string', name);
      assert.ok(!ns.required.includes(name), `${name} remains optional`);
    }
    assert.match(ns.properties.ns2.description, /Second resolver/);
    const sdn = tools.get('detach_private_network_port').inputSchema;
    assert.deepEqual(sdn.properties.port_id, sdn.properties.network_id);
    assert.equal(sdn.properties.port_id.type, 'string');
    assert.ok(sdn.properties.port_id.pattern);
    assert.ok(sdn.required.includes('port_id'));
    if (profile !== 'stdio') for (const name of ['create_vm_file', 'read_vm_file', 'write_vm_file']) {
      assert.match(tools.get(name).description, /https:\/\/www\.vpsnet\.com\/openapi-v1\.yml/);
      assert.match(tools.get(name).description, /mcpStartGuestOperation/);
    }
  });
}

test('pointer escaping, external references, validation siblings and cycles preserve constraints', () => {
  const schema = { type: 'object', properties: {
    'a/b~c': { type: 'string', minLength: 3, default: 'example' },
    copied: { $ref: '#/properties/a~1b~0c', description: 'Copied address' },
    stronger: { $ref: '#/properties/a~1b~0c', minLength: 7 },
    outside: { $ref: 'https://example.com/schema.json' },
    loop: { $ref: '#/properties/loop' },
    missing: { $ref: '#/properties/missing~2' },
  } };
  const result = inlineToolInputSchema(schema);
  assert.deepEqual(result.properties.copied, { type: 'string', minLength: 3, default: 'example', description: 'Copied address' });
  assert.deepEqual(result.properties.stronger.allOf, [schema.properties['a/b~c'], { minLength: 7 }]);
  for (const key of ['outside', 'loop', 'missing']) assert.deepEqual(result.properties[key], schema.properties[key]);
  assert.equal(schema.properties.copied.$ref, '#/properties/a~1b~0c', 'original SDK schema is untouched');
});

test('bounded expansion retains a finite original recursive subtree', () => {
  const schema = { type: 'object', properties: { node: { type: 'object', properties: {
    next: { $ref: '#/properties/node' }, value: { type: 'string', maxLength: 32 },
  } } } };
  const result = inlineToolInputSchema(schema);
  assert.equal(result.properties.node.properties.next.type, 'object');
  assert.deepEqual(result.properties.node.properties.next.properties.next, { $ref: '#/properties/node' });
  assert.equal(result.properties.node.properties.next.properties.value.maxLength, 32);
});
