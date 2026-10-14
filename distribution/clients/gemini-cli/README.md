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

Repository and release installation load the remote connector, context and shared skills. Gemini discovers bundled skills from `skills/` at the extension root. Restart Gemini CLI after installing.

In Gemini CLI, use `/mcp auth vpsnet` when authentication is requested. The browser opens the VPSnet sign-in and consent flow. Select services and permissions, then return to Gemini CLI. OAuth discovery and registration use server metadata; the extension contains no credentials or static bearer token. A local browser and loopback callback are required.

Start with: “Show my connected VPSnet servers and their state. Do not change anything.”

## Updates

For a repository installation, run `gemini extensions update vpsnet` in your terminal, then restart Gemini CLI. Automatic updates are optional through `--auto-update` at installation. For a local archive installation, extract the new complete package and reinstall its local directory. Use `/mcp reload` to rediscover changed remote tools; this does not replace installed skills.

## Access

Linux files and commands require separate permission. Functions execution requires separate consent to usage charges and a daily account usage ceiling. Disconnect through VPSnet's AI connections page to revoke access. This package manages existing services; it does not conduct purchases or direct customers into checkout.

## Extension gallery

The gallery automatically discovers public GitHub repositories with the `gemini-cli-extension` topic and a root `gemini-extension.json`. Publish the complete repository changes and add that topic for discovery. Preparing this package does not establish gallery indexing or a completed customer OAuth test.

[Support](https://www.vpsnet.com/en/help/contacts) · [Privacy](https://www.vpsnet.com/en/information/privacy-policy) · [Terms](https://www.vpsnet.com/en/information/term-of-service)

[Gemini extension reference](https://geminicli.com/docs/extensions/reference/) · [Release and gallery requirements](https://geminicli.com/docs/extensions/releasing/) · [MCP OAuth](https://geminicli.com/docs/tools/mcp-server/)
