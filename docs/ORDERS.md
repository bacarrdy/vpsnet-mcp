# Ordering with your VPSnet connection

Connect once at `https://mcp.vpsnet.com/mcp`. Where the AI application supports purchases, the same connection can order permanent Firecracker VPS, Cloud VPS (KVM), Container VPS and register domains from your VPSnet balance. Functions are a separate usage-billed service. Saved-card payments are not supported.

1. Enable the purchase permissions you want and set daily and monthly spending limits. For an already connected AI, use **VPSnet → AI connections → Purchase permissions**. No second connection or address is needed.
2. Ask the AI for a quote. It must show the final price and billing period, then ask whether you approve the purchase and the balance charge.
3. Confirm only if the price and configuration are correct. Domain registration also requires acknowledging that the payment is non-refundable.
4. The AI checks the result and the server or domain status. A payment receipt does not mean provisioning or registration has completed. Newly ordered servers receive only the management permissions already granted to this connection.

## Tool contract

`quote_service_order` and `quote_domain_register` do not purchase anything. Confirmation requires the unchanged configuration, quote token and idempotency key, the approved final EUR total, and `acknowledge_charge: true`. Domain confirmation also requires `acknowledge_non_refundable: true`; its approved price is `total_amount_eur` including VAT. Server quotes use `amount_eur`.

After a lost response, use `get_purchase_result` with the original key. An identical confirmation returns the saved receipt without another charge. A pending or unknown result must not be resubmitted with a new key. Disabling purchase permissions stops new purchases on the existing connection; revoking the connection stops all subsequent access.

## Wait for the same server

`confirm_service_order` and `get_purchase_result` return the financial receipt,
not current provisioning progress. `success: true` and `hasPayment: false` in a
settled balance receipt do not prove that the VM has finished creation. Keep its
`orderno` and original idempotency key. The additional `follow_up` object points
to the next tool; the original receipt fields remain unchanged.

| Observed result | What the AI should do |
| --- | --- |
| Financial result pending or unknown | Call `get_purchase_result` with the original key. Never confirm, pay or order again merely because the result is slow or a request timed out. |
| Financial success with `orderno` | Call `get_service` for that same order. Its `follow_up.purchase_state` stays separate from `follow_up.provisioning_state`. |
| `services:read` missing | Ask the customer to approve it by re-authorizing the existing connection, then inspect the same order. Creating the server does not grant a new scope or access to another connection. |
| `extra.pendingActivation`, `finalizing` or `stateProcess` active | Keep checking the same service. A percentage is a milestone, not an elapsed-time estimate; even 100% alone does not prove readiness. |
| Capacity, stock or `public_ip_inventory` wait | Preserve the original order. The platform resumes supported waits; do not reorder or restart it. |
| `stateProcess.attention`, `extra.operatorWaiting` or activation refresh disabled | Report operator attention and the original order number. Stop blind polling and automatic retries. |
| `state=create_failed` | Report the observed failure and `extra.createFailure` reason. Do not replace the order automatically. |
| `state=running`, pending activation and finalization clear, process cleared | The VM reports running. Guest-agent availability and application readiness still need their own evidence. |
| Stopped, suspended, incomplete or malformed response | Preserve that observation; do not infer readiness or restart automatically. |

The `follow_up` polling recommendation is about **10 seconds between checks**,
with **at most six checks before a progress update**. It is not a creation ETA.
If still pending, report the latest state and keep the key and order number for
the next check. A bounded wait expiring means pending, not failed. No background
completion notification is scheduled by this response.

Firecracker, KVM and Windows follow the same observed-state contract. KVM can
still be finalizing after activation; Windows also has guest configuration and
RDP setup. Do not assume a fixed boot time, claim Windows license activation,
or use Linux command tools as proof of Windows access. `get_guest_agent_status`
reports a separate capability; unknown agent status alone does not prove the
VM failed. Verify the requested application's installation and health or actual
endpoint before saying that application is ready.

`wait_for_event` accepts an actual event ID or `noty` UUID returned by an action.
An order number or payment ID is not that event ID. The remote MCP endpoint uses
stateless requests; panel notifications and email are not unsolicited callbacks
to an idle AI client. Only promise later notification when the client has a real,
separately configured background task that continues these checks.

## Operator setup

The backend and gateway use the same `/mcp` resource. Enable `MCP_OAUTH_ORDERS_ENABLED=true` on the customer backend and `VPSNET_MCP_ORDERS_ENABLED=true` on the gateway after deploying the consent and receipt migrations. Both default to disabled. No additional proxy path is needed.

The backend decides whether purchase tools are available to each application. Purchase-restricted applications keep the management tool profile on the same URL. By default, browser ChatGPT callback hosts are restricted for directory commerce rules. The operator setting `MCP_OAUTH_PURCHASE_BLOCKED_REDIRECT_HOSTS` controls this restriction for approved deployment channels; do not relax a published catalog’s restrictions without checking its current rules. Application display names never determine eligibility.
