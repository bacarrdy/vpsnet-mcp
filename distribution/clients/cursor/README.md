# VPSnet for Cursor

Use Cursor with your existing VPSnet services to deploy applications and websites, diagnose faults, configure networks, DNS and TLS, and create and test Functions. Choose your services and permissions when signing in.

## Local installation

Extract the complete Cursor package into `~/.cursor/plugins/local/vpsnet`. The package root contains `.cursor-plugin/plugin.json`, `cursor.mcp.json`, `skills/`, `assets/icon.png` and this README. Restart Cursor or run **Developer: Reload Window**, then open **Customize** to inspect its skills and MCP server. Local imports may be controlled by your organization's Cursor policy.

Connect the VPSnet MCP server through Cursor's browser OAuth flow. Sign in to VPSnet, select the services and permissions, and return to Cursor. The remote URL uses OAuth discovery and dynamic registration; no API key or bearer token belongs in this package.

Start with: “Show my connected VPSnet servers and their state. Do not change anything.”

Linux files and commands require separate permission. Functions execution requires separate consent to metered usage and a daily account usage ceiling. Disconnect through VPSnet's AI connections page to revoke access. This package manages existing services; it does not conduct purchases or direct customers into checkout.

## Official marketplace

Cursor accepts both Agent Plugins and Cursor Plugins from public Git repositories and reviews listings manually. Submit the complete, locally tested plugin through the official publisher page. The repository's existing `plugin/` directory supplies the portable Agent Plugins bundle; the native `.cursor-plugin/plugin.json` lives in the same complete `plugin/` directory and is indexed by the repository root `.cursor-plugin/marketplace.json`. The native archive uses this README and the bundled shared skills and logo. Preparing either format does not establish an accepted listing or a completed customer OAuth test.

[Support](https://www.vpsnet.com/en/help/contacts) · [Privacy](https://www.vpsnet.com/en/information/privacy-policy) · [Terms](https://www.vpsnet.com/en/information/term-of-service)

[Cursor plugin reference](https://cursor.com/docs/reference/plugins) · [MCP and OAuth](https://cursor.com/docs/mcp) · [Publish](https://cursor.com/marketplace/publish)
