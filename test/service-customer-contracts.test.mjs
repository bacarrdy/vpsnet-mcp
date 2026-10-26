import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { remoteScope } from '../build/remote-policy.js';

const KEY = 'backup.approved:attempt-0001';
const base = '/account/services/VP12345';
async function harness(t, dedicated = false) {
  const requests = [];
  const api = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ method: req.method, path: req.url, headers: req.headers, body });
    res.setHeader('content-type', 'application/json');
    let response = { success: true };
    if (req.url === `${base}/change-os` && req.method === 'GET') {
      response = { success: true, dedicated, confirmRequired: dedicated, os: [] };
    } else if (req.url === `${base}/backup` && req.method === 'POST') {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,189}$/.test(req.headers['idempotency-key'] || '')) {
        res.statusCode = 400; response = { idempotencyKeyRequired: true };
      } else response = { success: true, noty: '11111111-1111-4111-8111-111111111111' };
    } else if (req.url === `${base}/change-os` && req.method === 'POST') {
      if (dedicated && body.confirmReinstall !== true) { res.statusCode = 422; response = { baremetalReinstallConfirmationRequired: true }; }
      else response = { success: true, reinstall: '11111111-1111-4111-8111-111111111111' };
    } else if (req.url === `${base}/firecracker/backup/status`) {
      response = { success: true, running: 1, total: 2, latest_consistency_attested_by: 'guest_agent' };
    } else if (req.url === `${base}/firecracker/backup/history`) {
      response = { success: true, records: [{ id: 7, status: 'failed' }], backups: [{ id: 7, status: 'failed' }] };
    } else if (req.method === 'GET') {
      const query = new URL(req.url, 'http://127.0.0.1').searchParams;
      response = { success: true, records: [{ id: query.get('page') === '2' ? 1 : 51 }], pagination: { page: Number(query.get('page') || 1), pages: 2 } };
    }
    res.end(JSON.stringify(response));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(() => { api.closeAllConnections(); api.close(); });
  const client = new Client({ name: 'service-customer-contract', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['build/index.js'], env: {
    PATH: process.env.PATH, VPSNET_API_KEY: 'contract-test-key', VPSNET_API_URL: `http://127.0.0.1:${api.address().port}`,
  } }));
  t.after(() => client.close());
  return { client, requests, call: (name, args) => client.callTool({ name, arguments: { orderNo: 'VP12345', ...args } }) };
}

test('legacy backup purchase requires backend-compatible key and keeps it on replay', async t => {
  const { call, requests } = await harness(t);
  const args = { period: '2026-10-12', directories: '/', payment: { payment: 1, successUrl: '', cancelUrl: '' } };
  for (const idempotencyKey of [undefined, 'short', '_bad-first-character-0001']) {
    assert.equal((await call('create_backup', { ...args, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) })).isError, true);
  }
  assert.equal(requests.length, 0);
  for (let n = 0; n < 2; n++) assert.notEqual((await call('create_backup', { ...args, idempotencyKey: KEY })).isError, true);
  assert.equal(requests.length, 2);
  for (const req of requests) {
    assert.equal(req.headers['idempotency-key'], KEY);
    assert.deepEqual(req.body, args);
  }
});

test('history and SSH pagination reach older server records and keys', async t => {
  const { call, requests } = await harness(t);
  for (const [name, path, args] of [
    ['get_service_history', `${base}/history?page=2`, { page: 2 }],
    ['get_backup_history', `${base}/backup/history?page=2`, { page: 2 }],
    ['list_ssh_keys', '/account/ssh-keys?page=2&perPage=50', { page: 2, perPage: 50 }],
  ]) {
    const result = await call(name, args);
    assert.equal(requests.at(-1).path, path);
    assert.equal(JSON.parse(result.content[0].text).records[0].id, 1);
  }
  const before = requests.length;
  assert.equal((await call('list_ssh_keys', { perPage: 201 })).isError, true);
  assert.equal((await call('get_service_history', { page: 0 })).isError, true);
  assert.equal(requests.length, before);
});

test('dedicated reinstall requires exact disk-loss consent and supports backend credential choices', async t => {
  const { call, requests } = await harness(t, true);
  assert.equal((await call('reinstall_os', { osVersion: 7 })).isError, true);
  assert.equal((await call('reinstall_os', { osVersion: 7, confirmReinstall: false })).isError, true);
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
  const result = await call('reinstall_os', { osVersion: 7, confirmReinstall: true, sshKey: 12 });
  assert.notEqual(result.isError, true);
  assert.deepEqual(requests.at(-1).body, { osVersion: 7, confirmReinstall: true, sshKey: 12 });
  assert.ok(JSON.parse(result.content[0].text).reinstall);
  await call('reinstall_os', { osVersion: 7, confirmReinstall: true });
  assert.deepEqual(requests.at(-1).body, { osVersion: 7, confirmReinstall: true });
  assert.notEqual((await call('reinstall_os', { osVersion: 7, confirmReinstall: true, rootPassword: 'Synthetic123' })).isError, true);
  assert.deepEqual(requests.at(-1).body, { osVersion: 7, confirmReinstall: true, rootPassword: 'Synthetic123' });
  const before = requests.length;
  assert.equal((await call('reinstall_os', { osVersion: 7, confirmReinstall: true, rootPassword: 'Synthetic123', sshKey: 12 })).isError, true);
  assert.equal(requests.length, before, 'Mutually exclusive credentials fail before any backend call');
});

test('VPS reinstall rejects dedicated confirmation and forwards account SSH keys', async t => {
  const { call, requests } = await harness(t);
  assert.equal((await call('reinstall_os', { osVersion: 7, confirmReinstall: true, sshKey: 12 })).isError, true);
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
  assert.notEqual((await call('reinstall_os', { osVersion: 7, rootPassword: 'Synthetic123', confirmSnapshotDelete: true })).isError, true);
  assert.deepEqual(requests.at(-1).body, { osVersion: 7, rootPassword: 'Synthetic123', confirmSnapshotDelete: true });
  assert.notEqual((await call('reinstall_os', { osVersion: 7, sshKey: 12 })).isError, true);
  assert.deepEqual(requests.at(-1).body, { osVersion: 7, sshKey: 12 });
});

test('Firecracker backup reads use correct endpoints, preserve history and remain discoverable', async t => {
  const { client, call, requests } = await harness(t);
  const listed = (await client.listTools()).tools;
  for (const [name, suffix] of [['get_firecracker_backup_status', 'status'], ['get_firecracker_backup_history', 'history']]) {
    const tool = listed.find(t => t.name === name);
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(remoteScope(name), 'services:read');
    const result = JSON.parse((await call(name, {})).content[0].text);
    assert.equal(requests.at(-1).method, 'GET');
    assert.equal(requests.at(-1).path, `${base}/firecracker/backup/${suffix}`);
    if (suffix === 'history') { assert.equal(result.records[0].status, 'failed'); assert.deepEqual(result.records, result.backups); }
    else assert.equal(result.latest_consistency_attested_by, 'guest_agent');
  }
  for (const name of ['create_backup', 'create_snapshot', 'create_firecracker_snapshot', 'console_service']) assert.equal(remoteScope(name), undefined);
  assert.match(listed.find(t => t.name === 'console_service').description, /redemption requires the customer signed into the VPSnet panel/);
});
