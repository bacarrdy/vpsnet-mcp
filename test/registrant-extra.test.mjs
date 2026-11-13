import assert from 'node:assert/strict';
import test from 'node:test';
import { createVpsnetServer } from '../build/index.js';

const KEY = 'fixture-domain-' + '1'.repeat(16);
const TOKEN = 'a'.repeat(64);
const ANSWERS = { dk_accept_terms: '1', fi_birth_date: '1990-01-31', se_org_number: 5566778899 };
const PAYMENT = { payment: 1, successUrl: '', cancelUrl: '' };

function capture(t) {
  const original = globalThis.fetch;
  const saved = { url: process.env.VPSNET_API_URL, key: process.env.VPSNET_API_KEY };
  process.env.VPSNET_API_URL = 'http://127.0.0.1:9';
  process.env.VPSNET_API_KEY = 'fixture-only';
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ path: new URL(url).pathname, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ success: true, quoteToken: TOKEN }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => {
    globalThis.fetch = original;
    for (const [name, value] of [['VPSNET_API_URL', saved.url], ['VPSNET_API_KEY', saved.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  return requests;
}

test('registry answers reach the backend on registration and transfer quote and confirmation', async t => {
  const requests = capture(t);
  const server = createVpsnetServer();
  const call = (name, args) => { const tool = server._registeredTools[name]; return tool.handler(tool.inputSchema.parse(args)); };
  const base = { domain: 'example.dk', registrant_contact_id: 7, registrant_extra: ANSWERS, idempotencyKey: KEY };
  await call('quote_domain_register', base);
  await call('confirm_domain_register', { ...base, quoteToken: TOKEN, payment: PAYMENT });
  await call('quote_domain_transfer', { ...base, authCode: 'fixture-auth' });
  await call('confirm_domain_transfer', { ...base, authCode: 'fixture-auth', quoteToken: TOKEN, payment: PAYMENT });
  assert.deepEqual(requests.map(request => request.path), ['/account/domains/register/quote', '/account/domains/register/confirm',
    '/account/domains/transfer/quote', '/account/domains/transfer/confirm']);
  for (const request of requests) assert.deepEqual(request.body.registrant_extra, ANSWERS, request.path);
  await call('quote_domain_register', { domain: 'example.lt', idempotencyKey: KEY + '-lt' });
  assert.equal('registrant_extra' in requests.at(-1).body, false, 'nothing is invented when the registry asks nothing');
});

test('the hosted order profile keeps the answers on registration quote and confirmation', () => {
  const remote = createVpsnetServer({ remoteProfile: 'orders', remoteScopes: ['orders:domains', 'domains:read'] });
  const args = { domain: 'example.dk', idempotencyKey: KEY, registrant_extra: ANSWERS };
  assert.deepEqual(remote._registeredTools.quote_domain_register.inputSchema.parse(args).registrant_extra, ANSWERS);
  assert.deepEqual(remote._registeredTools.confirm_domain_register.inputSchema.parse({ ...args, quoteToken: TOKEN,
    expected_total_eur: 12.1, acknowledge_charge: true, acknowledge_non_refundable: true }).registrant_extra, ANSWERS);
  assert.match(remote.server._instructions ?? '', /registrant_extra/);
});

test('registry answers are bounded the way the backend bounds them', () => {
  const schema = createVpsnetServer()._registeredTools.quote_domain_register.inputSchema;
  const parse = registrant_extra => schema.safeParse({ domain: 'example.dk', idempotencyKey: KEY, registrant_extra }).success;
  assert.equal(parse(ANSWERS), true);
  assert.equal(parse({ 'Bad Key': '1' }), false);
  assert.equal(parse({ dk_accept_terms: 'x'.repeat(191) }), false);
  assert.equal(parse({ dk_accept_terms: { nested: true } }), false);
  assert.equal(parse(Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`field_${i}`, '1']))), false);
  assert.equal(parse(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`field_${i}`, '1']))), true);
});
