import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('release preparation and read-only update checks preserve authority and public boundaries', () => {
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'scripts/tests', '-p', 'test_release_updates.py'], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
