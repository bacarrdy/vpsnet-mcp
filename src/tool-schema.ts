import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/** Zod 3 int() accepted every finite integral number; v4 int() adds safe bounds.
 * Retain the existing input range where the contract never specified safe(). */
export function unboundedInteger() {
  return z.number().refine(Number.isInteger, "Expected integer").meta({ type: "integer" });
}

const MAX_DEPTH = 128;
const MAX_NODES = 100_000;
const annotations = new Set(['title', 'description', 'default', 'examples', '$comment']);
const schemaMaps = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies']);
const schemaArrays = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const childSchemas = new Set(['items', 'additionalItems', 'additionalProperties', 'unevaluatedItems', 'unevaluatedProperties', 'propertyNames', 'contains', 'not', 'if', 'then', 'else', 'contentSchema']);

/** Inline only references within this input schema, without changing validation. */
export function inlineToolInputSchema(schema: unknown, preserveClosedObjects = false): unknown {
  let remaining = MAX_NODES;
  function child(key: string, value: unknown, depth: number, ancestors: ReadonlySet<string>): unknown {
    if (schemaMaps.has(key) && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).map(([name, item]) => [name,
        // Draft-07 dependencies also accepts literal property-name arrays.
        key === 'dependencies' && Array.isArray(item) ? item : visit(item, depth, ancestors),
      ]));
    }
    if (schemaArrays.has(key) && Array.isArray(value)) return value.map(item => visit(item, depth, ancestors));
    if (childSchemas.has(key)) return visit(value, depth, ancestors);
    // Defaults, examples, const/enum values and extension data are instances,
    // not schemas: a literal object containing "$ref" must remain unchanged.
    return value;
  }
  function resolve(pointer: string): unknown {
    if (pointer === '#') return schema;
    if (!pointer.startsWith('#/')) return undefined;
    let current: unknown = schema;
    for (const encoded of pointer.slice(2).split('/')) {
      // A malformed JSON Pointer must retain its original reference.
      if (/~(?:[^01]|$)/.test(encoded)) return undefined;
      const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
      if (current === null || typeof current !== 'object'
          || !Object.prototype.hasOwnProperty.call(current, key)) return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  }
  function visit(value: unknown, depth: number, ancestors: ReadonlySet<string>): unknown {
    if (value === null || typeof value !== 'object') return value;
    // Keeping an original subtree/ref at a bound preserves its constraints.
    if (depth >= MAX_DEPTH || remaining-- <= 0) return value;
    if (Array.isArray(value)) return value.map(item => visit(item, depth + 1, ancestors));
    const object = value as Record<string, unknown>;
    const reference = object.$ref;
    if (typeof reference === 'string' && reference.startsWith('#') && !ancestors.has(reference)) {
      const target = resolve(reference);
      if (target !== undefined) {
        const expanded = visit(target, depth + 1, new Set([...ancestors, reference]));
        const siblings = Object.fromEntries(Object.entries(object)
          .filter(([key]) => key !== '$ref')
          .map(([key, item]) => [key, child(key, item, depth + 1, ancestors)]));
        if (expanded !== null && typeof expanded === 'object' && !Array.isArray(expanded)
            && Object.keys(siblings).every(key => annotations.has(key))) {
          return { ...expanded, ...siblings };
        }
        // Keep validation siblings conjunctive instead of overwriting target
        // constraints. Boolean schemas remain boolean unless there are siblings.
        return Object.keys(siblings).length ? { allOf: [expanded, siblings] } : expanded;
      }
    }
    const result = Object.fromEntries(Object.entries(object)
      .map(([key, item]) => [key, child(key, item, depth + 1, ancestors)]));
    // v3 advertised strip-mode objects as closed. Preserve the published input
    // contract; explicit catchalls and empty argument schemas stay untouched.
    if (preserveClosedObjects && result.type === 'object' && result.properties
        && Object.keys(result.properties).length && result.additionalProperties === undefined) {
      result.additionalProperties = false;
    }
    return result;
  }
  return visit(schema, 0, new Set());
}

/** Present self-contained schemas to clients; SDK/Zod execution stays unchanged. */
export function installToolInputSchemas(server: McpServer): void {
  const original = server.server.setRequestHandler.bind(server.server) as (...args: any[]) => void;
  server.server.setRequestHandler = ((schema: unknown, handler: (...args: any[]) => any) => {
    if (schema !== ListToolsRequestSchema) return original(schema, handler);
    return original(schema, async (...args: any[]) => {
      const response = await handler(...args);
      return { ...response, tools: response.tools.map((tool: Record<string, unknown>) => ({
        ...tool, inputSchema: inlineToolInputSchema(tool.inputSchema, true),
      })) };
    });
  }) as typeof server.server.setRequestHandler;
}
