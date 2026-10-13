# VPSnet for Kiro Powers

The existing VPSnet Agent Plugins package is also the Kiro Power source. Use `plugin.json`, `mcp.json`, `skills/`, README and license from the complete portable package. Kiro's current Powers submission format uses Agent Plugins; no separate `POWER.md` or custom manifest is required.

## Try the complete package

In Kiro, open **Powers → Add Custom Power → Import power from a folder** and select the extracted portable package root. Connect VPSnet with Kiro's browser OAuth flow, choose services and permissions, then return to Kiro. Kiro supports remote MCP OAuth and dynamic client registration without a fixed client ID.

Start with: “Show my connected VPSnet servers and their state. Do not change anything.” Check activation of the bundled skills and that only the consented services are returned. Linux commands and files need separate permission; Functions execution needs separate usage consent and a daily account usage ceiling. Disconnect in VPSnet's AI connections page to revoke access.

## Explicit read scope for a standalone connection

For the documented native Kiro configuration, merge the server entry from `kiro.mcp.json` into `.kiro/settings/mcp.json` in your workspace or `~/.kiro/settings/mcp.json` for your user. Preserve other server entries. The supplied `oauth.oauthScopes` requests `services:read` and leaves OAuth discovery and dynamic registration enabled. Additional operations still require the customer's separately selected permissions. This is a standalone MCP connection, not an override of a Power's automatically namespaced server; use one connection method to avoid duplicate OAuth connections.

The native OAuth fields belong to Kiro's MCP configuration, not the portable Agent Plugins schema. The Power package should retain its portable format and undergo its own OAuth check before registry submission.

## Registry submission

The public GitHub Power directory must contain the portable manifest, MCP configuration and skills. The publisher submits the repository link through Kiro's form with their own contact information and accepts the publisher terms. The specific use case is “Manage existing VPSnet services”. README must link privacy and support. Kiro requires a complete working Power and production MCP servers, followed by its own registry review.

Before submission, test the actual customer OAuth flow, discovery, callback, refresh and revocation, and verify the selected services and permissions. Preparing the package does not establish a successful customer sign-in or registry acceptance.

[Support](https://www.vpsnet.com/en/help/contacts) · [Privacy](https://www.vpsnet.com/en/information/privacy-policy) · [Terms](https://www.vpsnet.com/en/information/term-of-service)

[Create a Power](https://kiro.dev/docs/powers/create/) · [OAuth configuration](https://kiro.dev/docs/mcp/configuration/) · [Submit](https://kiro.dev/powers/submit/)
