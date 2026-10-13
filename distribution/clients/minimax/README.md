# VPSnet MiniMax Connector intake

MiniMax's official plugin submission guide supports customer OAuth through its App/Connector integration. A regular MCP capability is for servers that do not require MiniMax-managed customer authorization. VPSnet needs the App route because each customer signs in and selects services and permissions.

This folder provides public intake information; it is not an installable MiniMax plugin. MiniMax must configure and jointly test the Connector, then confirm a provider identifier for each requested target region. Only that confirmed identifier can be placed in the eventual App reference. No provider identifier is invented here.

## Public intake information

- Display name: VPSnet
- Suggested machine name: `vpsnet` (subject to MiniMax confirmation)
- Category: Code
- Website: https://www.vpsnet.com
- Public source: https://github.com/bacarrdy/vpsnet-mcp
- Production MCP endpoint: `https://mcp.vpsnet.com/mcp`
- Transport: HTTPS Streamable HTTP
- Authentication: customer OAuth with service and permission selection; discovery and dynamic client registration
- Desired distribution regions: CN and US, subject to separate integration and availability checks
- Desired delivery targets: Desktop (MiniMax Code) and Cloud (MiniMax Agent), subject to provider verification
- Description: Deploy applications and websites, troubleshoot servers, configure networks, DNS and TLS, and create and test Functions on existing VPSnet services with customer-selected access.
- Example: Show my connected VPSnet servers and their state. Do not change anything.

## Complete before creating the plugin

Ask MiniMax to confirm the Connector provider, supported regions and delivery targets after integration testing. Provide verified issuer/discovery URLs, resource and scope behavior, PKCE S256, registration, refresh and callback requirements, rate limits and error behavior through the agreed onboarding channel. Supply a reviewer-owned test account securely when requested. Credentials and private test addresses must stay outside the public package.

After provider confirmation, create `.minimax-plugin/plugin.json` with an `apps` entry referencing the confirmed `*.app.json`; use empty `mcpServers` and copy the shared VPSnet skills unchanged. The App reference must contain MiniMax's confirmed provider, never a guessed identifier. A ZIP must have `.minimax-plugin/plugin.json` directly at its root. CN and US catalog publication and Desktop/Cloud targets are selected in the submission workflow, not encoded as manifest delivery fields.

No submission has been made and no region or Connector availability has been verified by preparing this intake.

[Support](https://www.vpsnet.com/en/help/contacts) · [Privacy](https://www.vpsnet.com/en/information/privacy-policy) · [Terms](https://www.vpsnet.com/en/information/term-of-service)

[Official plugin submission and App integration requirements](https://agent.minimax.io/docs/code/agents/plugin-submission)
