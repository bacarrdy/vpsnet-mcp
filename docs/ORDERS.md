# Ordering with your VPSnet connection

Connect once at `https://mcp.vpsnet.com/mcp`. Where the AI application supports purchases, the same connection can order permanent Firecracker VPS, Cloud VPS (KVM), Container VPS and register domains from your VPSnet balance. Functions are a separate usage-billed service. Saved-card payments are not supported.

1. Enable the purchase permissions you want and set daily and monthly spending limits. For an already connected AI, use **VPSnet → AI connections → Purchase permissions**. No second connection or address is needed.
2. Ask the AI for a quote. It must show the final price and billing period, then ask whether you approve the purchase and the balance charge.
3. Confirm only if the price and configuration are correct. Domain registration also requires acknowledging that the payment is non-refundable.
4. The AI checks the result and the server or domain status. A payment receipt does not mean provisioning or registration has completed. Newly ordered servers receive only the management permissions already granted to this connection.

## Tool contract

`quote_service_order` and `quote_domain_register` do not purchase anything. Confirmation requires the unchanged configuration, quote token and idempotency key, the approved final EUR total, and `acknowledge_charge: true`. Domain confirmation also requires `acknowledge_non_refundable: true`; its approved price is `total_amount_eur` including VAT. Server quotes use `amount_eur`.

After a lost response, use `get_purchase_result` with the original key. An identical confirmation returns the saved receipt without another charge. A pending or unknown result must not be resubmitted with a new key. Disabling purchase permissions stops new purchases on the existing connection; revoking the connection stops all subsequent access.

## Operator setup

The backend and gateway use the same `/mcp` resource. Enable `MCP_OAUTH_ORDERS_ENABLED=true` on the customer backend and `VPSNET_MCP_ORDERS_ENABLED=true` on the gateway after deploying the consent and receipt migrations. Both default to disabled. No additional proxy path is needed.

The backend decides whether purchase tools are available to each application. Purchase-restricted applications keep the management tool profile on the same URL. By default, browser ChatGPT callback hosts are restricted for directory commerce rules. The operator setting `MCP_OAUTH_PURCHASE_BLOCKED_REDIRECT_HOSTS` controls this restriction for approved deployment channels; do not relax a published catalog’s restrictions without checking its current rules. Application display names never determine eligibility.
