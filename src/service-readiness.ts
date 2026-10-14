import { z } from 'zod';

const orderNo = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
const attemptKey = z.string().regex(/^[A-Za-z0-9._:-]{16,128}$/);

/** Advisory continuation, never an ETA, grant, background task or payment retry. */
export const serviceFollowUpSchema = z.object({
  purchase_state: z.enum(['accepted', 'pending', 'unknown']).nullable(),
  provisioning_state: z.enum(['pending', 'complete', 'not_running', 'needs_attention', 'failed', 'unknown']),
  permission_required: z.literal('services:read').nullable(),
  order_no: orderNo.nullable(),
  idempotency_key: attemptKey.nullable(),
  next_check: z.object({
    tool: z.enum(['get_service', 'get_purchase_result']),
    arguments: z.object({ orderNo: orderNo.optional(), idempotencyKey: attemptKey.optional() }),
  }).nullable(),
  poll_after_seconds: z.literal(10).nullable(),
  max_checks_before_update: z.literal(6),
  do_not_reorder: z.literal(true),
  background_notification: z.literal(false),
  server_running: z.boolean().nullable(),
  guest_agent_available: z.boolean().nullable(),
  application_ready: z.null(),
  message: z.string(),
});
type FollowUp = z.infer<typeof serviceFollowUpSchema>;
// Directory-only clients must not discover purchase tools through this schema.
export const serviceResultOutput = z.object({ follow_up: serviceFollowUpSchema.extend({
  next_check: z.object({ tool: z.literal('get_service'), arguments: z.object({ orderNo }) }).nullable(),
}) }).passthrough();
export const purchaseResultOutput = z.object({ follow_up: serviceFollowUpSchema.optional() }).passthrough();

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
function base(): FollowUp {
  return {
    purchase_state: null, provisioning_state: 'unknown', permission_required: null,
    order_no: null, idempotency_key: null, next_check: null, poll_after_seconds: null,
    max_checks_before_update: 6, do_not_reorder: true, background_notification: false,
    server_running: null, guest_agent_available: null, application_ready: null,
    message: 'Readiness is unknown. Inspect the original order; do not place another order or restart it.',
  };
}
const pendingMessage = 'Keep the same order and check again after about 10 seconds; this is a polling interval, not a completion estimate. Check at most 6 times before a progress update. If still pending, report that state and retain the order number for the next check. Do not reorder or restart. No background notification is scheduled.';

export function serviceReadiness(data: unknown, status: number, requestedOrderNo: string, remote = true): Record<string, unknown> {
  const response = object(data);
  const follow: FollowUp = { ...base(), order_no: requestedOrderNo };
  if (status === 403 && (response?.required_scope === 'services:read' || response?.requiredScope === 'services:read')) {
    follow.permission_required = 'services:read';
    follow.message = remote
      ? 'Service readiness could not be read. If services:read is missing, ask the customer to approve it by re-authorizing this existing connection. Do not grant it automatically or submit another order.'
      : 'Service readiness could not be read. Ask the owner to approve services:read for this management API key in the VPSnet panel, then inspect the same order. Do not change permissions automatically or submit another order.';
  } else if (status >= 200 && status < 300 && response?.success === true) {
    const service = object(response.service);
    const extra = object(service?.extra);
    const processValue = service && 'stateProcess' in service ? service.stateProcess : service?.stateProccess;
    const process = object(processValue);
    const state = service?.state;
    const sameOrder = service?.orderNo === requestedOrderNo;
    if (service && sameOrder && typeof state === 'string') {
      follow.next_check = { tool: 'get_service', arguments: { orderNo: requestedOrderNo } };
      follow.guest_agent_available = typeof extra?.guestAgentAvailable === 'boolean' ? extra.guestAgentAvailable : null;
      const waiting = extra?.pendingActivation === true || extra?.awaitingCapacity === true
        || extra?.awaitingStock === true || service.finalizing === true || process !== undefined;
      if (state === 'create_failed') {
        follow.provisioning_state = 'failed';
        follow.next_check = null;
        follow.message = 'The service reports create_failed. Preserve its createFailure reason and original order; report the failure and any operator attention. Do not automatically order, pay, retry provisioning or restart it.';
      } else if (process?.attention === true || extra?.operatorWaiting === true
          || (extra?.pendingActivation === true && extra.pendingActivationRefresh === false)) {
        follow.provisioning_state = 'needs_attention';
        follow.next_check = null;
        follow.message = 'This service reports operator attention. Report the original order number and observed reason; do not blindly retry, reorder, pay again or restart it.';
      } else if (waiting || ['creating', 'starting', 'restarting'].includes(state)) {
        follow.provisioning_state = 'pending';
        follow.poll_after_seconds = 10;
        follow.message = pendingMessage;
      } else if (state === 'running' && extra?.pendingActivation === false
          && service.finalizing === false && processValue === null) {
        follow.provisioning_state = 'complete';
        follow.server_running = true;
        follow.next_check = null;
        follow.message = 'The service reports a running VM with provisioning and finalization clear. Guest-agent availability is separate and advisory; verify the required guest capability before using it. Application health, endpoint reachability and Windows license activation are not proved by this result.';
      } else if (['stopped', 'suspended'].includes(state)) {
        follow.provisioning_state = 'not_running';
        follow.server_running = false;
        follow.next_check = null;
        follow.message = 'The service is not running. Inspect the observed state and the original order before proposing a change; do not automatically reorder or restart.';
      }
    }
  }
  return { ...(response ?? { success: false, error: 'invalid_service_response' }), follow_up: follow };
}

/** Preserve the financial receipt, then explicitly hand off to its service. */
export function purchaseReadiness(data: unknown, status: number, key: string, canReadServices: boolean, receiptRecovery = true): Record<string, unknown> {
  const response = object(data) ?? { success: false, error: 'invalid_purchase_response' };
  // Domain receipts belong to the registrar workflow, not service provisioning.
  if (typeof response.domain_id === 'number' || object(response.domain) || typeof response.domain === 'string') return response;
  const follow: FollowUp = { ...base(), idempotency_key: key, purchase_state: 'unknown' };
  const parsedOrder = orderNo.safeParse(response.orderno);
  if (status >= 200 && status < 300 && response.success === true && parsedOrder.success) {
    follow.purchase_state = 'accepted';
    follow.order_no = parsedOrder.data;
    follow.next_check = { tool: 'get_service', arguments: { orderNo: parsedOrder.data } };
    if (!canReadServices) {
      follow.permission_required = 'services:read';
      follow.message = 'The financial request succeeded; provisioning is not verified. Ask the customer to approve services:read by re-authorizing this existing connection, then inspect this same order. Never grant permissions automatically, create another connection/order, pay again or restart the server.';
    } else {
      follow.message = 'The financial request succeeded; this receipt is not server readiness. Call get_service with this order number now, then follow its state checks. Retain the original key and order; never pay or order again because provisioning is slow.';
    }
  } else {
    follow.next_check = { tool: 'get_purchase_result', arguments: { idempotencyKey: key } };
    follow.poll_after_seconds = 10;
    if (status === 202 && response.state === 'pending' && response.idempotencyKey === key) follow.purchase_state = 'pending';
    follow.message = 'The financial outcome is pending or unknown. Inspect get_purchase_result with this original key; do not submit another confirmation, order or key. Check at most 6 times at about 10-second intervals, then report the unresolved outcome and retain the key. A timeout is not proof of failure; no background notification is scheduled.';
    if (!receiptRecovery) {
      follow.next_check = null;
      follow.poll_after_seconds = null;
      follow.message = 'The financial outcome is unresolved. Inspect this original attempt in the VPSnet panel; local API-key ordering has no durable purchase-result tool. Retain the key and never submit another confirmation, order or key to retry an uncertain purchase.';
    }
  }
  return { ...response, follow_up: follow };
}
