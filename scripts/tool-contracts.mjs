#!/usr/bin/env node
// Discover raw SDK descriptors; never call a VPSnet tool or contact the backend.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { createVpsnetServer } from '../build/index.js';

export const root = new URL('../', import.meta.url);
export const snapshotDirectory = new URL('test/fixtures/tool-contracts/', root);
// OpenAI uses the same directory descriptor set; there is no separate OpenAI profile.
export const profiles = {
  stdio: {},
  directory: { remoteScopes: ['services:read'], remoteProfile: 'directory' },
  orders: { remoteScopes: ['services:read', 'orders:read', 'orders:servers', 'orders:domains'], remoteProfile: 'orders' },
};
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])]));
  return value;
}
export async function discoverTools(options) {
  const server = createVpsnetServer(options);
  const client = new Client({ name: 'vpsnet-tool-contract', version: '1.0.0' });
  const [a,b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(b); await client.connect(a);
    // Client.listTools() strips top-level extensions such as securitySchemes.
    // A permissive result schema retains the actual wire descriptor for comparison.
    const result = await client.request({ method: 'tools/list' },z.object({ tools:z.array(z.record(z.unknown())) }));
    return result.tools;
  } finally { await client.close(); await server.close(); }
}
export function descriptorsByName(tools) {
  const result = {};
  for (const tool of tools) {
    if (Object.hasOwn(result,tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
    result[tool.name] = canonical(tool);
  }
  return canonical(result);
}
export function validateDescriptors(profile,tools) {
  const errors=[];
  for (const tool of tools) {
    for (const field of ['name','title','description']) if (typeof tool[field]!=='string' || !tool[field].trim()) errors.push(`${tool.name}.${field} must be nonempty`);
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)) errors.push(`${tool.name}: invalid name`);
    if (typeof tool.annotations?.title!=='string' || !tool.annotations.title.trim()) errors.push(`${tool.name}: missing annotation title`);
    for (const hint of ['readOnlyHint','destructiveHint','openWorldHint']) if (typeof tool.annotations?.[hint]!=='boolean') errors.push(`${tool.name}.${hint} must be boolean`);
    if (tool.annotations?.readOnlyHint && tool.annotations.destructiveHint) errors.push(`${tool.name}: read-only cannot be destructive`);
    if (tool.inputSchema?.type!=='object') errors.push(`${tool.name}: missing object input schema`);
    if (profile!=='stdio' && (!Array.isArray(tool.securitySchemes) || tool.securitySchemes.length===0 || !isDeepStrictEqual(tool.securitySchemes,tool._meta?.securitySchemes))) errors.push(`${tool.name}: security declaration mirror differs`);
  }
  descriptorsByName(tools);
  return errors;
}
// Descriptor deltas avoid copying identical schemas three times. The inclusion list
// is exact; a base tool not explicitly included is absent from this profile.
export function makeSnapshot(profile,tools,base) {
  const descriptors=descriptorsByName(tools);
  if (!base) return { schema_version:1,profile,tools:descriptors };
  const overrides={};
  for (const [name,tool] of Object.entries(descriptors)) {
    const previous=base.tools[name] ?? {};
    const set=Object.fromEntries(Object.entries(tool).filter(([key,value])=>!isDeepStrictEqual(value,previous[key])));
    const remove=Object.keys(previous).filter(key=>!Object.hasOwn(tool,key));
    if (Object.keys(set).length || remove.length) overrides[name]={ set,...(remove.length?{remove}:{}) };
  }
  return canonical({schema_version:1,profile,base:base.profile,included:Object.keys(descriptors),overrides});
}
export function expandSnapshot(snapshot,base) {
  if (!snapshot.base) return snapshot;
  if (snapshot.base!==base?.profile) throw new Error(`Wrong snapshot base for ${snapshot.profile}`);
  const tools={};
  for (const name of snapshot.included) {
    if (Object.hasOwn(tools,name)) throw new Error(`Duplicate snapshot tool: ${name}`);
    const patch=snapshot.overrides[name] ?? {};
    const descriptor={...(base.tools[name] ?? {}),...(patch.set ?? {})};
    for (const key of patch.remove ?? []) delete descriptor[key];
    if (descriptor.name!==name) throw new Error(`Missing descriptor: ${name}`);
    tools[name]=descriptor;
  }
  for (const name of Object.keys(snapshot.overrides)) if (!Object.hasOwn(tools,name)) throw new Error(`Unused override: ${name}`);
  return {schema_version:1,profile:snapshot.profile,tools:canonical(tools)};
}
export function readSnapshots() {
  const snapshots={};
  for (const profile of Object.keys(profiles)) {
    const snapshot=JSON.parse(readFileSync(new URL(`${profile}.json`,snapshotDirectory),'utf8'));
    snapshots[profile]=expandSnapshot(snapshot,snapshots[snapshot.base]);
  }
  return snapshots;
}
export function changedContracts(expected,actual) {
  const names=new Set([...Object.keys(expected),...Object.keys(actual)]);
  return [...names].sort().flatMap(name=>{
    if (!Object.hasOwn(expected,name)) return [`added ${name}`];
    if (!Object.hasOwn(actual,name)) return [`removed ${name}`];
    return Object.keys({...expected[name],...actual[name]}).sort().filter(key=>!isDeepStrictEqual(expected[name][key],actual[name][key])).map(key=>`changed ${name}.${key}`);
  });
}
export async function captureProfiles() {
  const captured={};
  for (const [profile,options] of Object.entries(profiles)) {
    const tools=await discoverTools(options);
    const errors=validateDescriptors(profile,tools);
    if (errors.length) throw new Error(errors.join('\n'));
    captured[profile]={schema_version:1,profile,tools:descriptorsByName(tools)};
  }
  return captured;
}
async function main() {
  const args=process.argv.slice(2);
  const updating=args[0]==='--update' && args.length===2 && args[1].trim().length>=12;
  if (!updating && !(args.length===1 && args[0]==='--check')) throw new Error('Use --check, or --update "reviewed reason or issue reference". Updating never runs in CI.');
  if (updating && process.env.CI) throw new Error('Snapshot updates are disabled in CI.');
  const captured=await captureProfiles();
  if (updating) {
    mkdirSync(snapshotDirectory,{recursive:true});
    for (const profile of Object.keys(profiles)) {
      const base=profile==='stdio'?undefined:captured[profile==='directory'?'stdio':'directory'];
      const snapshot=makeSnapshot(profile,Object.values(captured[profile].tools),base);
      writeFileSync(new URL(`${profile}.json`,snapshotDirectory),JSON.stringify(snapshot,null,2)+'\n');
    }
    console.log(`Updated snapshots for review: ${args[1]}. Inspect and commit the diff; this does not approve or publish tools.`);
    return;
  }
  const expected=readSnapshots();let drift=false;
  for (const profile of Object.keys(profiles)) {
    const changed=changedContracts(expected[profile].tools,captured[profile].tools);
    console.log(`${profile}: ${Object.keys(captured[profile].tools).length} tools${changed.length?' — DRIFT':''}`);
    if (changed.length) { drift=true; console.error(changed.join('\n')); }
  }
  if (drift) throw new Error('Tool contract changed. Review behavior, compatibility/changelog and explicit effect policy before updating snapshots.');
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
