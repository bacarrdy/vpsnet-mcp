import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function failurePayload(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  const error = payload.error;
  const hasError = error === true
    || (typeof error === "string" && error.trim().length > 0)
    || (error !== null && typeof error === "object" && Object.keys(error).length > 0);

  return payload.success === false
    || hasError
    || (typeof payload.http_status === "number" && payload.http_status >= 400)
    || payload.state === "error";
}

/**
 * Mark returned API failures after the tool's existing safe projection.
 * Capability values such as backup `status: false` are ordinary read results.
 * Keep the response body and recovery guidance unchanged, and never retry.
 */
export function markToolResultError<Result extends CallToolResult>(result: Result): Result {
  if (result.isError === true) return result;

  const failed = failurePayload(result.structuredContent)
    || result.content.some((content) => {
      if (content.type !== "text") return false;
      try {
        return failurePayload(JSON.parse(content.text));
      } catch {
        return false;
      }
    });

  return failed ? { ...result, isError: true } : result;
}

/** Preserve each registered handler's arguments and return type. */
export function withToolResultErrorFlag<Args extends unknown[], Result extends CallToolResult>(
  handler: (...args: Args) => Result | Promise<Result>
): (...args: Args) => Promise<Result> {
  return async (...args) => markToolResultError(await handler(...args));
}

type RegisteredHandler = (...args: unknown[]) => CallToolResult | Promise<CallToolResult>;
type RegisterTool = (name: string, config: unknown, handler: RegisteredHandler) => unknown;

/**
 * Install before registering tools. Erase the SDK's conditional callback types
 * only inside this adapter; callers retain the original generic registerTool
 * signature, and the SDK still validates each handler's input schema.
 */
export function installToolResultErrorFlag(server: McpServer): void {
  const registerTool = server.registerTool.bind(server) as unknown as RegisterTool;
  const wrapped: RegisterTool = (name, config, handler) =>
    registerTool(name, config, withToolResultErrorFlag(handler));
  server.registerTool = wrapped as unknown as typeof server.registerTool;
}
