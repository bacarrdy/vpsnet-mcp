import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const validate = path => spawnSync('python3', [join(root, 'scripts/validate_plugin.py'), path], { encoding: 'utf8' });

test('directory package meets offline requirements', () => {
  const result = validate(join(root, 'plugin'));
  assert.equal(result.status, 0, result.stderr);
});

for (const [name, mutate, reason] of [
  ['four starter prompts', (p, d) => d.extensions['com.openai'].interface.defaultPrompt.push('A fourth prompt'), 'At most three starter prompts'],
  ['low contrast branding', (p, d) => { d.extensions['com.openai'].interface.brandColor = '#00dcd7'; }, 'contrast below 2:1'],
  ['missing README detail', p => writeFileSync(join(p, 'README.md'), 'VPSnet plugin'), 'README needs at least 40 words'],
  ['symlink inside package', p => symlinkSync('README.md', join(p, 'readme-link')), 'Symlink:'],
  ['private reviewer credentials', (p, d) => { d.extensions['com.openai'].review.test_credentials = 'not-a-real-secret'; }, 'Private review field'],
]) {
  test(`rejects ${name}`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'vpsnet-plugin-test-'));
    try {
      cpSync(join(root, 'plugin'), dir, { recursive: true });
      const file = join(dir, 'plugin.json');
      const manifest = JSON.parse(readFileSync(file, 'utf8'));
      mutate(dir, manifest);
      writeFileSync(file, JSON.stringify(manifest));
      const result = validate(dir);
      assert.notEqual(result.status, 0, result.stdout);
      assert.ok(result.stderr.includes(reason), result.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
