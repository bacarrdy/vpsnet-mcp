import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { captureProfiles, profiles, readSnapshots, changedContracts, validateDescriptors, expandSnapshot } from '../scripts/tool-contracts.mjs';

const expected=readSnapshots();
const actual=await captureProfiles();
for (const profile of Object.keys(profiles)) {
  test(`${profile} raw tools/list exactly matches its reviewed contract snapshot`,()=>{
    const changes=changedContracts(expected[profile].tools,actual[profile].tools);
    assert.deepEqual(changes,[],changes.join('\n')+'\nSee docs/TOOL_CONTRACTS.md before an intentional snapshot update.');
  });
}
test('impact policy is independent of names, HTTP verbs and permission suffixes',()=>{
  const policy=JSON.parse(readFileSync(new URL('./fixtures/tool-contracts/impact-policy.json',import.meta.url),'utf8'));
  for (const rule of policy.cases) {
    assert.ok(rule.reason && rule.evidence,'Effects need review evidence, not only copied flags');
    for (const profile of rule.profiles) for (const name of rule.tools) {
      const tool=actual[profile].tools[name];
      assert.ok(tool,`${profile}: policy tool missing: ${name}`);
      assert.equal(tool.annotations.readOnlyHint,rule.readOnlyHint,`${profile}.${name}: ${rule.reason}`);
      assert.equal(tool.annotations.destructiveHint,rule.destructiveHint,`${profile}.${name}: ${rule.reason}`);
    }
  }
});
test('drift reports exact name, title, description, annotation, input, output and OAuth changes',()=>{
  const before=expected.directory.tools;
  for (const [field,value] of Object.entries({title:'Unexpected title',description:'Unexpected description',
    annotations:{readOnlyHint:true},inputSchema:{type:'object',properties:{extra:{type:'string'}}},
    outputSchema:{type:'string'},securitySchemes:[{type:'noauth'}],_meta:{securitySchemes:[{type:'noauth'}]}})) {
    const mutated=structuredClone(before);mutated.browse_restore_files[field]=value;
    assert.deepEqual(changedContracts(before,mutated),[`changed browse_restore_files.${field}`]);
  }
  const removed=structuredClone(before);delete removed.browse_restore_files;
  assert.deepEqual(changedContracts(before,removed),['removed browse_restore_files']);
  const renamed=structuredClone(removed);renamed.browse_backup_files={...before.browse_restore_files,name:'browse_backup_files'};
  assert.deepEqual(changedContracts(before,renamed),['added browse_backup_files','removed browse_restore_files']);
});
test('required metadata and mirrored authority fail independently of a matching snapshot',()=>{
  const original=actual.directory.tools.browse_restore_files;
  const missing=structuredClone(original);delete missing.title;delete missing.description;delete missing.annotations.readOnlyHint;delete missing.annotations.destructiveHint;
  assert.equal(validateDescriptors('directory',[missing]).length,4);
  const mismatch=structuredClone(original);mismatch.securitySchemes=[{type:'noauth'}];
  assert.ok(validateDescriptors('directory',[mismatch]).some(e=>e.includes('security declaration')));
  const absentAuthority=structuredClone(original);delete absentAuthority.securitySchemes;delete absentAuthority._meta.securitySchemes;
  assert.ok(validateDescriptors('directory',[absentAuthority]).some(e=>e.includes('security declaration')));
  const contradictory=structuredClone(original);contradictory.annotations.readOnlyHint=true;contradictory.annotations.destructiveHint=true;
  assert.ok(validateDescriptors('directory',[contradictory]).some(e=>e.includes('cannot be destructive')));
});
test('profile inclusion cannot silently inherit new tools from the base',()=>{
  const base={profile:'stdio',tools:{existing:{name:'existing'},unexpected:{name:'unexpected'}}};
  const expanded=expandSnapshot({profile:'directory',base:'stdio',included:['existing'],overrides:{}},base);
  assert.deepEqual(Object.keys(expanded.tools),['existing']);
  assert.throws(()=>expandSnapshot({profile:'directory',base:'stdio',included:['existing','existing'],overrides:{}},base),/Duplicate/);
});
test('CI and ambiguous update commands cannot rewrite reviewed snapshots',()=>{
  for (const args of [['--update'],['--update','short'],['--update','reviewed test-only change']]) {
    const result=spawnSync(process.execPath,['scripts/tool-contracts.mjs',...args],{cwd:new URL('../',import.meta.url),env:{...process.env,CI:'true'},encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/Use --check|disabled in CI/);
  }
});
