# Langdock directory intake draft

Prepared 2026-10-14. **Not sent.** This requests review; it does not claim that
VPSnet has passed Langdock's test.

Documented intake: `support@langdock.com`, from the
[official directory instructions](https://docs.langdock.com/en/using-langdock/integrations/mcp-directory).
Use an authorized company sender. Before sending, supply a verified technical
reply contact, working isolated reviewer access or demo signup path, attach the
[square logo](../../../plugin/assets/icon.png), and confirm permission for
Langdock's review testing. Keep credentials in private correspondence.

Subject: VPSnet official remote MCP — directory review

> Please consider VPSnet for your MCP server directory.
>
> Company/product: VPSnet — https://www.vpsnet.com
> Server: VPSnet — https://mcp.vpsnet.com/mcp
> - Transport: HTTPS Streamable HTTP
> - Documentation: https://github.com/bacarrdy/vpsnet-mcp/blob/main/docs/REMOTE_MCP.md
> - Support: https://www.vpsnet.com/en/help/contacts
> - Privacy: https://www.vpsnet.com/en/information/privacy-policy
>
> Customers connect their VPSnet account through OAuth, select services and
> permissions, and manage existing servers, applications, DNS, private networks
> and Functions. OAuth discovery and dynamic client registration are supported.
> No customer model API key is required by VPSnet.
>
> Directory access excludes purchases, billing and account API-key management.
> Existing services have their own prices. Functions execution, including failed
> runs, consumes metered usage only with separate execution consent, a daily
> ceiling and per-call acknowledgment.
>
> We propose testing a small read-only tool subset first, followed by explicitly
> authorized changes on isolated test services. Actual Langdock compatibility
> has not yet been established.

Add the real reviewer access/signup and technical contact privately before sending.
The authorized sender must also confirm official maintenance and testing permission.

For the pilot, stay within Langdock's 60 **enabled** tools and turn confirmations
on for mutations/sensitive actions. Test separate-user OAuth, service filtering,
refresh/revocation/reconnect and requested-scope upgrades. Record results and the
provider's decision privately. After listing, capture its exact public URL/version;
a successful email delivery is not acceptance.
