import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createVpsnetServer } from '../build/index.js';
import { installToolTitles } from '../build/remote-policy.js';

test('registration fills only missing annotation titles and preserves authored metadata', () => {
  const registrations = [];
  const server = {
    registerTool(name, config, handler) {
      assert.equal(this, server);
      const registration = { name, config, handler };
      registrations.push(registration);
      return registration;
    },
  };
  installToolTitles(server);
  const handler = async () => ({ content: [] });
  const config = { title: 'Authored display title', annotations: { readOnlyHint: true, destructiveHint: false } };
  assert.equal(server.registerTool('read_vm_file', config, handler), registrations[0]);
  assert.equal(registrations[0].config.annotations.title, 'Authored display title');
  assert.deepEqual(registrations[0].config.annotations, {
    readOnlyHint: true, destructiveHint: false, openWorldHint: true, title: 'Authored display title',
  });
  assert.equal(config.annotations.title, undefined, 'the original configuration is not mutated');
  assert.equal(registrations[0].config.title, 'Authored display title');
  assert.equal(registrations[0].handler, handler);

  server.registerTool('get_rdns', { annotations: { title: 'Read reverse DNS', openWorldHint: true } }, handler);
  assert.equal(registrations[1].config.annotations.title, 'Read reverse DNS');
  assert.equal(registrations[1].config.annotations.openWorldHint, true);
  server.registerTool('set_private_network_dns', { inputSchema: {} }, handler);
  assert.equal(registrations[2].config.annotations.title, 'Set private network DNS');
});

async function discover(options) {
  const server = createVpsnetServer(options);
  const client = new Client({ name: 'tool-title-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return (await client.listTools()).tools; }
  finally { await client.close(); await server.close(); }
}

test('stdio, directory and orders discovery expose complete human-readable annotation titles', async () => {
  const cases = [
    ['stdio', {}, { get_rdns: 'Get rDNS', set_private_network_dns: 'Set private network DNS' }],
    ['directory', { remoteScopes: ['services:read'] }, {
      get_rdns: 'Get rDNS', set_private_network_dns: 'Set private network DNS',
      open_vm_session: 'Open VM session', get_connected_account: 'Get connected account',
    }],
    ['orders', { remoteScopes: ['services:read', 'orders:servers', 'orders:domains'], remoteProfile: 'orders' }, {
      get_purchase_result: 'Get purchase result', quote_service_order: 'Quote service order',
    }],
  ];
  for (const [profile, options, expected] of cases) {
    const tools = await discover(options);
    assert.ok(tools.length > 150, `${profile} lists its complete tool family`);
    for (const tool of tools) {
      assert.equal(typeof tool.annotations?.title, 'string', `${profile}: ${tool.name}`);
      assert.ok(tool.annotations.title.trim().length > 0, `${profile}: ${tool.name}`);
      assert.doesNotMatch(tool.annotations.title, /_/, `${profile}: ${tool.name}`);
      assert.equal(tool.title, tool.annotations.title, `${profile}: ${tool.name}`);
      for (const hint of ['readOnlyHint', 'destructiveHint', 'openWorldHint']) {
        assert.equal(typeof tool.annotations[hint], 'boolean', `${profile}: ${tool.name}.${hint}`);
      }
      if (tool.annotations.readOnlyHint) assert.equal(tool.annotations.destructiveHint, false, `${profile}: ${tool.name}`);
    }
    const byName = new Map(tools.map(tool => [tool.name, tool]));
    for (const [name, title] of Object.entries(expected)) {
      assert.equal(byName.get(name)?.annotations?.title, title, `${profile}: ${name}`);
    }
    assert.equal(byName.get('get_application_health')?.annotations?.title,
      'Inspect managed application health', `${profile}: authored annotation remains intact`);
    if (profile !== 'stdio') {
      assert.equal(byName.get('set_private_network_dns')?.annotations?.destructiveHint, true);
      assert.equal(byName.get('get_rdns')?.annotations?.readOnlyHint, true);
    }
  }
});

// These expectations follow backend effects, not HTTP verbs or tool-name prefixes.
// BE80bbca6: ResourceController calculator is pure; quoted domain intents persist;
// snapshot GETs may finish pending rollback; Functions GETs repair hidden billing anchors.
test('legacy stdio fills impact hints from actual operation effects', async () => {
  const tools = new Map((await discover({})).map(tool => [tool.name,tool]));
  const cases = {
    calculate_plan_change: [true,false],
    console_service: [false,false],
    quote_domain_register: [false,false],
    order_service: [false,true],
    browse_restore_files: [false,false],
    list_snapshots: [false,true],
    create_snapshot: [false,true],
    list_firecracker_snapshots: [true,false],
    list_functions: [false,false],
    get_function: [false,false],
    get_hostname: [false,true],
    create_domain_contact: [false,true],
    create_backup: [false,true],
  };
  for (const [name,[readOnly,destructive]] of Object.entries(cases)) {
    assert.equal(tools.get(name).annotations.readOnlyHint,readOnly,name);
    assert.equal(tools.get(name).annotations.destructiveHint,destructive,name);
  }
});

// Intentionally reviewed hosted corrections; read scopes do not promise a pure read.
test('hosted reconciliation and default-contact replacement expose their actual impact', async () => {
  const expected = {
    list_snapshots: [false,true,'services:read'],
    get_hostname: [false,true,'services:read'],
    list_functions: [false,false,'functions:read'],
    get_function: [false,false,'functions:read'],
    create_domain_contact: [false,true,'domains:manage'],
  };
  for (const remoteProfile of ['directory','orders']) {
    const tools = new Map((await discover({remoteScopes:['services:read','orders:read','orders:servers','orders:domains'],remoteProfile})).map(tool=>[tool.name,tool]));
    for (const [name,[readOnly,destructive,scope]] of Object.entries(expected)) {
      const tool=tools.get(name);
      assert.equal(tool.annotations.readOnlyHint,readOnly,`${remoteProfile}: ${name}`);
      assert.equal(tool.annotations.destructiveHint,destructive,`${remoteProfile}: ${name}`);
      assert.deepEqual(tool._meta.securitySchemes,[{type:'oauth2',scopes:[scope]}],`${remoteProfile}: scope unchanged`);
    }
  }
});
