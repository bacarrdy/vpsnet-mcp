# Connect an AI application to VPSnet

Use `https://mcp.vpsnet.com/mcp` with an application that supports remote MCP
over Streamable HTTP and customer OAuth. Sign in to VPSnet, choose your services
and permissions, and return to your AI conversation. VPSnet does not require a
model API key. The model and its usage limits belong to your chosen AI account.

Start with: “Show my connected VPSnet servers and what is running. Ask before
making changes.” Files, commands and metered Functions execution need their
respective permissions. Disconnect in **AI connections** in the VPSnet panel.

| Application | Setup |
| --- | --- |
| ChatGPT / Codex | Add a remote OAuth connector or install the VPSnet plugin when listed in the directory. |
| Claude / Cowork / Claude Code | Add the remote OAuth connector, or use the repository's `plugin/` package and Claude marketplace. |
| Gemini browser | Add a custom app where your account and region support it. |
| Grok | Add a Custom connector with the MCP address. |
| Gemini CLI | [Extension setup](../distribution/clients/gemini-cli/README.md). |
| Cursor | [Native plugin setup](../distribution/clients/cursor/README.md). |
| Kimi Code | [Native plugin setup](../distribution/clients/kimi-code/README.md). Kimi Work's web marketplace is a separate publishing channel. |
| Kiro | [Power and scoped MCP setup](../distribution/clients/kiro/README.md). Use one method to avoid duplicate connections. |
| Cline | [Installation guide](../llms-install.md). |
| Mistral Vibe Work (formerly Le Chat) | Connectors → Add Connector → Custom MCP Connector, then use the VPSnet URL and OAuth. Vibe Code CLI has different authentication support. |
| Perplexity | Add a custom remote connector and choose OAuth authentication; availability depends on the account. |
| Qwen Code | Configure a remote HTTP MCP server using the VPSnet URL and complete the client's browser OAuth flow. |

An AI model being available in an editor does not imply that the model provider
has its own plugin marketplace. These setup formats are distinct from a public
listing or a completed compatibility test on your account.

## Releases

Plugin bundles contain manifests and skills. The `vpsnet-mcp` npm package
contains the local MCP implementation. Publishing a GitHub commit does not
publish a new npm version or a marketplace listing.

Native bundles use the shared skills from `plugin/skills`; no extra server or
model adapter is needed. Their exact filenames and SHA-256 values are recorded
in `release-manifest.json` by `scripts/package-distribution.py`. Install a
released version rather than assuming a candidate has passed provider review.

## Official client instructions

- [Mistral Work connectors](https://docs.mistral.ai/vibe/work/connectors/mcp-connectors)
  and [Code CLI authentication](https://docs.mistral.ai/vibe/code/cli/mcp-servers).
- [Perplexity custom remote connectors](https://www.perplexity.ai/help-center/en/articles/13915507-adding-custom-remote-connectors).
- [Qwen Code MCP](https://github.com/QwenLM/qwen-code/blob/main/docs/developers/tools/mcp-server.md).
- [Gemini browser requirements](https://support.google.com/gemini/answer/17209137).
- [Grok connectors](https://docs.x.ai/grok/connectors).
