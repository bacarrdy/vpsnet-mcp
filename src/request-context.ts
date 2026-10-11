import { AsyncLocalStorage } from "node:async_hooks";

export interface AuthorizationContext {
  accessToken: string;
  subject: string;
  grantId: string;
  scopes: readonly string[];
  services: readonly string[];
  expiresAt: number;
}
const contexts = new AsyncLocalStorage<AuthorizationContext>();
let remoteOnly = false;

export function requireRequestAuthorization(): void { remoteOnly = true; }
export function authorizationContext(): AuthorizationContext | undefined { return contexts.getStore(); }
export function withAuthorization<T>(context: AuthorizationContext, work: () => T): T {
  return contexts.run(Object.freeze({ ...context, scopes: Object.freeze([...context.scopes]), services: Object.freeze([...context.services]) }), work);
}
export function apiAuthorization(fallback: () => string): Record<string, string> {
  const context = contexts.getStore();
  if (context) {
    if (context.expiresAt <= Date.now() / 1000) throw new Error("The VPSnet connection expired. Reconnect your account.");
    return { Authorization: `Bearer ${context.accessToken}` };
  }
  if (remoteOnly) throw new Error("Remote MCP requests require an authenticated request context.");
  return { "X-API-KEY": fallback() };
}
