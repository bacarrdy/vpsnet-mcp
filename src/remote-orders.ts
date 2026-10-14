import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { apiRequest, formatJson } from './api.js';
import { hasScope } from './remote-policy.js';
import { purchaseReadiness, purchaseResultOutput } from './service-readiness.js';

const key = z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/).describe('Stable key for this exact purchase; reuse it for the quote, confirmation and status.');
const configuration = {
  plan: z.number().int().positive(),
  os: z.number().int().positive().optional(),
  sshKey: z.number().int().positive().optional().describe('Existing public SSH key ID; mutually exclusive with rootPassword.'),
  rootPassword: z.string().min(6).max(40).optional().describe('Only when the selected OS requires a password; prefer an existing SSH key for Linux.'),
  period: z.number().int().positive().optional(),
  resources: z.array(z.number().int().positive()).optional(),
  privateNetworkId: z.string().uuid().optional(),
  idempotencyKey: key,
};
const payment = { payment: 1, successUrl: '', cancelUrl: '' };
const result = (status: number, data: unknown) => ({ ...(status >= 400 ? { isError: true } : {}), content: [{ type: 'text' as const, text: formatJson(data) }] });

export function registerOrderTools(server: McpServer, scopes: readonly string[] = []): void {
  server.registerTool('quote_service_order', {
    description: 'Quote one permanent Firecracker VPS, Cloud VPS (KVM) or Container VPS using the selected current plan, OS, resources and period. No payment is made. Show the final amount_eur and billing period, then obtain explicit approval before confirm_service_order. Functions is a separate usage-billed product.',
    inputSchema: configuration,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async input => {
    const { status, data } = await apiRequest('POST', '/account/mcp/orders/services/quote', { ...input, payment }, { 'Idempotency-Key': input.idempotencyKey });
    return result(status, data);
  });
  server.registerTool('confirm_service_order', {
    description: 'Purchase the exact previously quoted server from VPSnet balance after explicit customer approval of its final EUR total and billing period. Supply the unchanged quote configuration, token and key. Never automatically create a new key after an uncertain result: inspect get_purchase_result. A receipt is not a ready server. Poll get_purchase_result for the financial outcome; get_service for the returned orderno additionally requires services:read. Follow follow_up for provisioning checks, permission requirements and bounded progress updates. The suggested 10-second polling interval is not an ETA. This connection receives access to its newly ordered server only within the permissions the customer granted.',
    inputSchema: { ...configuration,
      quoteToken: z.string().min(32).max(256),
      expected_total_eur: z.number().finite().nonnegative().describe('Exact final amount_eur from the quote, shown to and approved by the customer.'),
      acknowledge_charge: z.literal(true).describe('The customer explicitly approved this exact balance charge.'),
    },
    outputSchema: purchaseResultOutput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async input => {
    const { status, data } = await apiRequest('POST', '/account/mcp/orders/services/confirm', { ...input, payment }, { 'Idempotency-Key': input.idempotencyKey, 'X-Quote-Token': input.quoteToken });
    const output = purchaseReadiness(data, status, input.idempotencyKey, hasScope(scopes, 'services:read'));
    return { ...result(status, output), structuredContent: output };
  });
  server.registerTool('get_purchase_result', {
    description: 'Inspect this connection’s existing financial purchase attempt by its original idempotency key. This replays a financial receipt, not live provisioning progress. Pending or unknown must not trigger a second order. Follow follow_up: a returned server orderno is checked with get_service; if services:read is missing, re-authorize this existing connection without ordering again. A domain remains pending until its registrar status confirms registration. Do not promise an idle client a completion callback.',
    inputSchema: { idempotencyKey: key },
    outputSchema: purchaseResultOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ idempotencyKey }) => {
    const { status, data } = await apiRequest('GET', `/account/mcp/orders/requests/${encodeURIComponent(idempotencyKey)}`);
    const output = purchaseReadiness(data, status, idempotencyKey, hasScope(scopes, 'services:read'));
    return { ...result(status, output), structuredContent: output };
  });
}
