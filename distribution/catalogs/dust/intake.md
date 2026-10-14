# Dust directory intake draft

Prepared 2026-10-14. **Not sent.** This requests testing and an intake decision,
not an assumed catalog listing.

The [provider-hosted September 29 community guidance](https://community.dust.tt/x/intros/msg_qQ03sphKVq69/how-to-submit-motleys-mcp-for-listing-on-dusts-nat)
invites technical test instructions at the publicly supplied intake contact,
`raphael-ext@dust.tt`. This is community guidance, not a self-service publication
API or guaranteed approval timeline. Reconfirm the contact before sending.

Use an authorized company sender. Supply a real technical reply contact,
isolated reviewer access or working demo signup instructions privately.
Do not put credentials or reviewer account details in this repository.

Subject: VPSnet remote OAuth MCP — testing and directory intake

> Could you review VPSnet's remote MCP connection and advise on directory intake?
>
> - Endpoint: https://mcp.vpsnet.com/mcp
> - Transport: HTTPS Streamable HTTP
> - Auth: customer OAuth with metadata discovery and dynamic client registration
> - Docs: https://github.com/bacarrdy/vpsnet-mcp/blob/main/docs/REMOTE_MCP.md
> - Product/support: https://www.vpsnet.com / https://www.vpsnet.com/en/help/contacts
>
> Customers select their own VPSnet services and permissions to inspect or
> manage existing servers, applications, DNS, private networks and Functions.
> Use Personal Level Credentials for separate customer authorization.
>
> Directory access excludes purchases, billing and account API-key management.
> Existing services have their own prices. Functions execution, including failed
> runs, consumes metered usage only with separate execution consent, a daily
> ceiling and per-call acknowledgment.
>
> We suggest an isolated read-only pilot, then authorized changes on test
> services. Actual Dust compatibility has not yet been established. Please
> advise on the current test-access requirements and subsequent listing process.

Follow [Dust MCP setup](https://docs.dust.tt/docs/user-documentation/admins/tools-management/adding-an-mcp-server.md)
and [personal versus shared credentials](https://docs.dust.tt/docs/user-documentation/admins/tools-management/personal-vs-shared-credentials.md).
Validate callback acceptance, separate users, selected services, refresh/reconnect
and write confirmations before claiming compatibility. Record any actual review
decision and live listing separately from connector creation.
