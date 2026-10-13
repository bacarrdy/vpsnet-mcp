import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { remoteScope } from '../build/remote-policy.js';

const network = '00000000-0000-4000-8000-000000000001';

test('Functions tools bind private-network attach/clear and paginated history without extra mutations', async (t) => {
  const requests = [];
  const api = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ success: true, pagination: { page: 2, pages: 3 }, invocations: [] }));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(() => api.close());
  const client = new Client({ name: 'function-contract', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['build/index.js'], env: {
    ...process.env, VPSNET_API_KEY: 'contract-test-key', VPSNET_API_URL: `http://127.0.0.1:${api.address().port}`,
  } }));
  t.after(() => client.close());
  const { tools } = await client.listTools();
  const history = tools.find(tool => tool.name === 'list_function_history');
  assert.equal(history.annotations.readOnlyHint, true);
  assert.equal(remoteScope('list_function_history'), 'functions:read');
  assert.equal(remoteScope('list_temp_vms'), undefined);
  for (const name of ['create_function', 'update_function']) {
    assert.ok(tools.find(tool => tool.name === name).inputSchema.properties.private_network_id);
  }
  const result = await client.callTool({ name: 'list_function_history', arguments: {
    function_id: 1, page: 2, limit: 25, status: 'failed', search: 'VP12345 & example.com',
  } });
  assert.equal(JSON.parse(result.content[0].text).pagination.pages, 3);
  const url = new URL(requests[0].url, 'http://example.com');
  assert.equal(requests[0].method, 'GET');
  assert.equal(url.pathname, '/account/firecracker/functions/history');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    function_id: '1', status: 'failed', search: 'VP12345 & example.com', limit: '25', page: '2',
  });
  await client.callTool({ name: 'create_function', arguments: {
    name: 'VP12345', runtime_os_id: 1, code: 'print(1)', private_network_id: network,
  } });
  assert.equal(requests[1].body.private_network_id, network);
  await client.callTool({ name: 'update_function', arguments: { function_id: 1, private_network_id: null } });
  assert.deepEqual(requests[2].body, { private_network_id: null });
  await client.callTool({ name: 'update_function', arguments: { function_id: 1, enabled: false } });
  assert.deepEqual(requests[3].body, { enabled: false });
  const before = requests.length;
  const invalid = await client.callTool({ name: 'list_function_history', arguments: { page: 0 } });
  assert.equal(invalid.isError, true);
  assert.equal(requests.length, before);
});
