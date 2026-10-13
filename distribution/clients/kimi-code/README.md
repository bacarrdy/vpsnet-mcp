# VPSnet for Kimi Code

Use your existing VPSnet services from Kimi Code: deploy applications and websites, diagnose server faults, configure networks, DNS and TLS, and create and test Functions with customer-selected access.

## Install the native package

The complete native package contains `kimi.plugin.json`, the shared VPSnet `skills/` directory, this README and a license. Extract it into `vpsnet`, then run in Kimi Code:

```text
/plugins install ./vpsnet
/reload
```

Open `/plugins` to inspect the enabled plugin and its MCP server. If OAuth is requested, use `/mcp-config login` with the server name shown in Kimi's MCP panel. Sign in to VPSnet in your browser, select services and permissions, then return to Kimi Code. The remote URL contains no bearer token; OAuth uses the client's browser flow.

Start with: “Show my connected VPSnet servers and their state. Do not change anything.”

Linux files and commands need separate permission. Functions execution requires separate consent to usage charges and a daily account usage ceiling. This package manages existing services; it does not conduct purchases or direct customers into checkout. Disconnect through VPSnet's AI connections page to revoke access.

## Kimi marketplace

Kimi Work's Plugin Builder can convert existing plugin files or project links into a personal plugin. Upload the complete package, then check the generated plugin's OAuth connection and capabilities. Conversion is a separate step; source format compatibility alone does not prove that a generated plugin works.

After testing a personal plugin, its details page provides a publication application entry. Follow Kimi's official publication guide and provide the publisher's real information through that workflow. Availability varies by Kimi surface and region. This native package is prepared for Kimi Code; it is not evidence of marketplace approval, automatic recommendations or a completed customer OAuth test.

[Support](https://www.vpsnet.com/en/help/contacts) · [Privacy](https://www.vpsnet.com/en/information/privacy-policy) · [Terms](https://www.vpsnet.com/en/information/term-of-service)

[Native plugin format](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins.html) · [MCP OAuth](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html) · [Personal plugin conversion](https://www.kimi.com/en/help/plugins-and-skills/create) · [Publication](https://www.kimi.com/en/help/plugins-and-skills/publish)
