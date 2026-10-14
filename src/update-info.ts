import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const RELEASE_FEED_URL = 'https://raw.githubusercontent.com/bacarrdy/vpsnet-mcp/main/distribution/releases/published.json';
export const MAX_FEED_BYTES = 65536;
const stable = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const entry = z.object({
  version: z.string().max(63).regex(stable), source_commit: z.string().regex(/^[0-9a-f]{40}$/),
  verified_at: z.string().max(40).datetime({ offset: true }), url: z.string().max(256),
  sha256: z.string().regex(/^[0-9a-f]{64}$/), ci_run: z.number().int().positive().safe(),
  ci_conclusion: z.literal('success'),
}).strict();
const feedSchema = z.object({ schema_version: z.literal(1), plugin: entry, mcp: entry }).strict();
type Feed = z.infer<typeof feedSchema>;
const instructions = JSON.parse(readFileSync(new URL('../scripts/update-clients.json', import.meta.url), 'utf8')) as Record<string, {
  reviewed_at: string; source_urls: string[]; steps: string[];
}>;
const runtimeVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;

export function validatePublishedFeed(value: unknown): Feed {
  const feed = feedSchema.parse(value);
  if (feed.plugin.url !== `https://github.com/bacarrdy/vpsnet-mcp/releases/download/plugin-${feed.plugin.version}/vpsnet-plugin-${feed.plugin.version}.zip`
      || feed.mcp.url !== `https://registry.npmjs.org/vpsnet-mcp/-/vpsnet-mcp-${feed.mcp.version}.tgz`) {
    throw new Error('Unexpected release artifact URL');
  }
  return feed;
}

/** Reject duplicate keys (including escaped aliases) before normal JSON parsing. */
export function parsePublishedFeed(text: string): Feed {
  const token = /\s*("(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|[{}\[\],:])/gy;
  const stack: Array<{ object: boolean; key: boolean; keys: Set<string> }> = [];
  let position = 0;
  while (position < text.length && text.slice(position).trim()) {
    token.lastIndex = position;
    const match = token.exec(text);
    if (!match) throw new Error('Invalid release JSON');
    const value = match[1], frame = stack.at(-1);
    if (value === '{' || value === '[') stack.push({ object: value === '{', key: value === '{', keys: new Set() });
    else if (value === '}' || value === ']') stack.pop();
    else if (value === ',' && frame?.object) frame.key = true;
    else if (value.startsWith('"') && frame?.object && frame.key) {
      const name = JSON.parse(value) as string;
      if (frame.keys.has(name)) throw new Error('Duplicate release key');
      frame.keys.add(name); frame.key = false;
    }
    position = token.lastIndex;
  }
  return validatePublishedFeed(JSON.parse(text));
}

export async function fetchPublishedFeed(fetcher: typeof fetch = fetch): Promise<Feed> {
  const response = await fetcher(RELEASE_FEED_URL, {
    redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' },
  });
  if (response.status !== 200 || !response.body) throw new Error('Release feed unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FEED_BYTES) throw new Error('Release feed too large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return parsePublishedFeed(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

let cache: { expires: number; value: Promise<Feed> } | undefined;
async function cachedFeed(): Promise<Feed> {
  if (!cache || cache.expires <= Date.now()) {
    // Public facts only: never cache account data, tokens or installed versions.
    cache = { expires: Date.now() + 300_000, value: fetchPublishedFeed() };
  }
  return cache.value;
}

const observedSchema = z.object({ version: z.string().nullable(), source: z.enum(['caller_reported', 'runtime', 'unknown']) });
export const updateInfoOutput = {
  schema_version: z.literal(1), checked_at: z.string(), client: z.string(),
  published: z.object({ plugin: entry, mcp: entry }).nullable(),
  observed: z.object({ plugin: observedSchema, local_mcp: observedSchema, server: observedSchema }),
  update_available: z.object({ plugin: z.boolean().nullable(), local_mcp: z.boolean().nullable(), server: z.boolean().nullable() }),
  compatibility: z.object({ status: z.literal('unknown'), reason: z.string() }),
  distribution_status: z.object({ source_release_published: z.boolean().nullable(), npm_package_published: z.boolean().nullable(),
    remote_deployment_status: z.literal('unknown'), official_registry: z.object({ status: z.literal('unknown'), version: z.null(), checked_at: z.null() }),
    downstream_catalogs: z.record(z.unknown()),
  }),
  instructions: z.object({ reviewed_at: z.string(), source_urls: z.array(z.string()), steps: z.array(z.string()) }).nullable(),
  server_update: z.string(), advisory: z.literal(true), reason: z.string().nullable(),
};

function observed(value?: string, runtime = false) {
  return value && value.length < 64 && stable.test(value)
    ? { version: value, source: runtime ? 'runtime' as const : 'caller_reported' as const }
    : { version: null, source: 'unknown' as const };
}
function older(current: string | null, latest: string): boolean | null {
  if (current === null) return null;
  const a = current.split('.').map(BigInt), b = latest.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

export async function getUpdateInfo(args: { client?: string; pluginVersion?: string; localMcpVersion?: string }, lookup: () => Promise<Feed> = cachedFeed) {
  let published: Feed | null = null;
  try { published = validatePublishedFeed(await lookup()); } catch { /* Do not echo untrusted errors. */ }
  const client = args.client ?? 'generic';
  const observations = { plugin: observed(args.pluginVersion), local_mcp: observed(args.localMcpVersion), server: observed(runtimeVersion, true) };
  return z.object(updateInfoOutput).parse({
    schema_version: 1, checked_at: new Date().toISOString(), client,
    published: published ? { plugin: published.plugin, mcp: published.mcp } : null,
    observed: observations,
    update_available: { plugin: published ? older(observations.plugin.version, published.plugin.version) : null,
      local_mcp: published ? older(observations.local_mcp.version, published.mcp.version) : null,
      server: published ? older(observations.server.version, published.mcp.version) : null },
    compatibility: { status: 'unknown', reason: 'No version-specific client acceptance evidence is supplied by this check.' },
    distribution_status: { source_release_published: published ? true : null, npm_package_published: published ? true : null,
      remote_deployment_status: 'unknown', official_registry: { status: 'unknown', version: null, checked_at: null }, downstream_catalogs: {} },
    instructions: Object.hasOwn(instructions, client) ? instructions[client] : null,
    server_update: 'The hosted gateway is maintained by VPSnet. Updating a local npm package does not update it.',
    advisory: true,
    reason: published ? null : 'Published release information is unavailable or invalid; installed software is unchanged.',
  });
}
