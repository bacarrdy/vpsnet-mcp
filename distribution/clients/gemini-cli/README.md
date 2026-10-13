# VPSnet for Gemini CLI

Connect Gemini CLI to your existing VPSnet services. Deploy applications and websites, diagnose faults, configure networks, DNS and TLS, and create and test Functions with the access you select.

## Install

Install the published extension from its public repository:

```sh
gemini extensions install https://github.com/bacarrdy/vpsnet-mcp
```

A release archive contains the complete extension, including the shared VPSnet skills. Extract it into a directory named `vpsnet` and install that local directory:

```sh
gemini extensions install ./vpsnet
```

Repository installation loads the remote connector and its context. Gemini discovers bundled skills from `skills/` at the extension root; the release package supplies that directory. Restart Gemini CLI after installing.

In Gemini CLI, use `/mcp auth vpsnet` when authentication is requested. The browser opens the VPSnet sign-in and consent flow. Select services and permissions, then return to Gemini CLI. OAuth discovery and registration use server metadata; the extension contains no credentials or static bearer token. A local browser and loopback callback are required.

Start with: “Show my connected VPSnet servers and their state. Do not change anything.”

## Access

Linux files and commands require separate permission. Functions execution requires separate consent to usage charges and a daily account usage ceiling. Disconnect through VPSnet's AI connections page to revoke access. Purchases depend on the connected application and its advertised tools. Where available, use the same connection with separate purchase permissions, spending limits and explicit approval of the final balance charge.

## Extension gallery

The gallery discovers public GitHub repositories with the `gemini-cli-extension` topic and a root `gemini-extension.json`. Listing requires publication of the repository changes, that topic and successful provider validation. Preparing this package does not establish gallery acceptance or a completed customer OAuth test.

[Support](https://www.vpsnet.com/en/help/contacts) · [Privacy](https://www.vpsnet.com/en/information/privacy-policy) · [Terms](https://www.vpsnet.com/en/information/term-of-service)

[Gemini extension reference](https://geminicli.com/docs/extensions/reference/) · [Release and gallery requirements](https://geminicli.com/docs/extensions/releasing/) · [MCP OAuth](https://geminicli.com/docs/tools/mcp-server/)
