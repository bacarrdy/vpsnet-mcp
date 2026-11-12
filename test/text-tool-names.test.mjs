import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import test from 'node:test';

// The texts an AI or a person reads (server instructions, every tool description, the README count, docs and the
// bundled skills) may name only tools that exist, so a tool cannot be added, renamed or removed without them following.
process.env.VPSNET_API_KEY ||= 'contract-test-key';
const { discoverTools, profiles } = await import('../scripts/tool-contracts.mjs');
const { createVpsnetServer } = await import('../build/index.js');
const { remoteInstructions, orderInstructions } = await import('../build/remote-policy.js');

const stdio = await discoverTools(profiles.stdio);
const hosted = [...await discoverTools(profiles.directory), ...await discoverTools(profiles.orders)];
const known = new Set([...stdio, ...hosted].map(tool => tool.name));
// Tool-shaped words that are not tool names: fields, settings, reason codes and other packages' tools.
const notTools = new Set(['add_txt', 'add_txt_at_previous_provider', 'add_txt_in_parent_zone', 'apply_blocking_records', 'apply_error', 'confirm_field', 'confirm_outage', 'rotate_webhook_secret', 'change_validation', 'recheck_validation', 'remove_domain', 'replace_domain', 'configure_routes', 'restart_delta', 'install_requirements', 'read_bytes', 'read_ops', 'write_bytes', 'write_ops', 'list_changed', 'renew_periods', 'update_available', 'download_available', 'manage_reason', 'check_failed', 'create_failed', 'order_availability', 'retry_after', 'prepare_after_payment', 'open_to_internet', 'get_service_rescue_capability', 'list_services_page', 'ssh_connect', 'ssh_exec', 'ssh_keygen', 'sftp_write', 'sftp_read', 'sftp_ls', 'ssh_system_info', 'ssh_disconnect']);
const verbs = 'get|list|create|set|delete|update|attach|detach|move|bind|retry|order|quote|confirm|renew|disable|enable|check|take|rotate|start|stop|restart|rebuild|apply|reset|recheck|remove|add|install|uninstall|configure|manage|deploy|change|clear|flush|toggle|reinstall|suspend|resume|enter|exit|browse|request|rollback|invoke|wait|open|run|read|write|cancel|export|import|upsert|verify|reissue|reapply|download|upload|find|estimate|save|revoke|clone|retire|prepare|validate|discover|inspect|reconcile|repair|refresh|replace|recheck|abort|extract|search|stat|preflight';
const toolWord = new RegExp(`\\b(?:${verbs})_[a-z0-9]+(?:_[a-z0-9]+)*\\b`, 'g');

function names(text) {
  return [...new Set([...text.matchAll(toolWord)].map(match => match[0]))]
    .filter(word => !notTools.has(word) && !/_(?:id|ids|at|url|key|token|seconds|minutes|enabled|state|kind|mode|scope|count|limit)$/.test(word));
}
function unknown(text) { return names(text).filter(word => !known.has(word)); }
function files(dir) {
  return readdirSync(new URL(`../${dir}/`, import.meta.url)).flatMap(entry => {
    const path = `${dir}/${entry}`;
    return statSync(new URL(`../${path}`, import.meta.url)).isDirectory() ? files(path) : path.endsWith('.md') ? [path] : [];
  });
}

test('server instructions name only registered tools', () => {
  const instructions = createVpsnetServer().server._instructions ?? '';
  assert.ok(instructions.length > 1000);
  assert.deepEqual(unknown(instructions), []);
  assert.deepEqual(unknown(remoteInstructions), []);
  assert.deepEqual(unknown(orderInstructions(['orders:read', 'orders:servers', 'orders:domains'])), []);
});

test('every tool and parameter description names only registered tools', () => {
  for (const tool of [...stdio, ...hosted]) {
    assert.deepEqual(unknown(JSON.stringify({ description: tool.description, input: tool.inputSchema })), [], tool.name);
  }
});

test('README, docs and bundled skills name only registered tools, and the README count is the stdio count', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, new RegExp(`<!-- tool-count -->${stdio.length}<!-- /tool-count -->`));
  for (const path of ['README.md', 'llms-install.md', ...files('docs'), ...files('plugin/skills')]) {
    assert.deepEqual(unknown(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')), [], path);
  }
});
