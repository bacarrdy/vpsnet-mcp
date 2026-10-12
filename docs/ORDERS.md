# Optional custom ordering connection

The optional `https://mcp.vpsnet.com/mcp/orders` resource supports permanent Firecracker VPS, Cloud VPS (KVM), Container VPS and domain registration paid from the customer's VPSnet balance. Functions remain a separate usage-billed service. Saved cards are not supported by this resource.

Use this custom connection only where the AI provider permits purchasing digital services. The distributable directory package uses `/mcp` and does not include purchase tools. Enabling ordering on the server does not add it to that package.

## Customer flow

1. Add the orders address as a custom connection and sign in to VPSnet.
2. Choose server ordering, domain registration or both, and set daily and monthly EUR limits. Confirm identity when prompted. Existing management permissions do not include purchases.
3. Ask the AI for a quote. Review the final total and billing period before approving payment. Domain registration requires acknowledging its non-refundable payment.
4. Inspect the purchase result. A successful payment does not mean the server or domain is ready; check its status. Newly ordered servers join this connection only with the management permissions already granted.

The tools separate `quote_service_order` / `confirm_service_order` and `quote_domain_register` / `confirm_domain_register`. Confirmation requires the same configuration, quote token and idempotency key, the exact approved EUR total, and `acknowledge_charge: true`. Domain registration also requires `acknowledge_non_refundable: true`; use its `total_amount_eur` including VAT. Server quotes use `amount_eur`.

Use `get_purchase_result` after a lost response. Repeating an identical confirmation returns its existing receipt. A pending/unknown outcome must not be retried with a new key. Spending limits apply across token refreshes; revoking the connection stops subsequent actions.

## Deployment

The customer backend must support the orders consent, routes and receipt migration. Set `MCP_OAUTH_ORDERS_ENABLED=true` there and `VPSNET_MCP_ORDERS_ENABLED=true` on the gateway. Both default to disabled. The reverse proxy must pass `/mcp/orders` and `/.well-known/oauth-protected-resource/mcp/orders` to the same gateway. Its OAuth audience is the exact orders URL; tokens for `/mcp` cannot be reused there or vice versa.
