import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeCatalog, scopeDescriptions } from '../build/scope-catalog.js';
import { hasScope, supportedScopes, orderScopes } from '../build/remote-policy.js';

test('every scope disclosure describes exactly the access implied by runtime policy', () => {
  const accepted = [...supportedScopes, ...orderScopes, 'vm:files'];
  assert.deepEqual(new Set(Object.keys(scopeCatalog)), new Set(accepted));
  for (const [scope, entry] of Object.entries(scopeCatalog)) {
    for (const language of ['en', 'lt']) {
      assert.ok(entry.label[language]?.trim(), scope);
      assert.ok(entry.description[language]?.trim(), scope);
    }
    const implied = accepted.filter(required => required !== scope && hasScope([scope], required));
    assert.deepEqual(new Set(entry.implies), new Set(implied), scope);
    assert.equal(entry.legacy, scope === 'vm:files');
  }
});

test('discovery descriptions follow profile scopes and disclose balance spending', () => {
  assert.equal(Object.keys(scopeDescriptions(supportedScopes)).length, 25);
  assert.equal(Object.keys(scopeDescriptions([...supportedScopes, ...orderScopes])).length, 28);
  assert.equal(scopeDescriptions(supportedScopes)['vm:files'], undefined);
  assert.equal(scopeDescriptions(supportedScopes)['orders:servers'], undefined);
  for (const scope of ['functions:invoke', 'orders:servers', 'orders:domains']) {
    assert.notEqual(scopeCatalog[scope].billing, 'none');
    assert.match(scopeCatalog[scope].description.en, /VPSnet balance/);
  }
  assert.match(scopeCatalog['services:restore'].description.en, /delete/);
});
