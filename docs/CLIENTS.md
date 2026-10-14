# Connect an AI application to VPSnet

Use `https://mcp.vpsnet.com/mcp` with an application that supports remote MCP
over Streamable HTTP and customer OAuth. Sign in to VPSnet, choose your services
and permissions, and return to your AI conversation. VPSnet does not require a
model API key. The model and its usage limits belong to your chosen AI account.

Start with: “Show my connected VPSnet servers and what is running. Ask before
making changes.” Files, commands and metered Functions execution need their
respective permissions. Disconnect in **AI connections** in the VPSnet panel.

If authorization is lost, follow the [reconnect workflow](REMOTE_MCP.md#reconnect-after-losing-authorization).
Consent presets can grant only the [scopes requested by the client](REMOTE_MCP.md#why-some-consent-choices-are-unavailable);
additional permissions require a new authorization request and approval.

| Application | Setup |
| --- | --- |
| ChatGPT / Codex | Add a remote OAuth connector or install the VPSnet plugin when listed in the directory. |
| Claude / Cowork / Claude Code | Add the remote OAuth connector, or use the repository's `plugin/` package and Claude marketplace. |
| Gemini browser / mobile | Add a custom app in the web app's Connected Apps settings. Currently requires a personal Google Account, age 18+, US location, English and Keep Activity enabled; then usable on web and mobile. |
| Grok | Add a Custom connector with the MCP address. |
| Gemini CLI | [Extension setup](../distribution/clients/gemini-cli/README.md). |
| Cursor | [Native plugin setup](../distribution/clients/cursor/README.md). |
| Kimi Code / Work | [Native Code plugin setup and separate Work conversion](../distribution/clients/kimi-code/README.md). Work's Plugin Builder currently requires its latest desktop app. |
| Kiro | [Power and scoped MCP setup](../distribution/clients/kiro/README.md). Use one method to avoid duplicate connections. |
| Cline | [Installation guide](../llms-install.md). |
| Mistral Vibe Work (formerly Le Chat) | An administrator uses Connectors → Add Connector → Custom MCP Connector; enter `vpsnet` and the URL, then Connect and complete automatically detected OAuth. Vibe Code CLI does not support OAuth MCP servers, so it cannot directly use this customer connection. |
| Perplexity | Settings → Connectors → Custom connector → Remote; choose OAuth and Streamable HTTP, add the URL and authenticate from the connector card. Available on documented Pro, Max and Enterprise plans; organization policies may restrict creation. |
| Qwen Code | Run `qwen mcp add --scope user --transport http vpsnet https://mcp.vpsnet.com/mcp`, restart Qwen if already running, then use `/mcp` to complete browser OAuth. JSON uses `httpUrl` for Streamable HTTP; `url` selects SSE. |
| VS Code / GitHub Copilot | Use **MCP: Add Server**, or native `.vscode/mcp.json` with a top-level `servers` object and `type: "http"`. Copilot's portable `.mcp.json` format uses `mcpServers` instead. See the README's [VS Code setup](../README.md#vs-code-with-github-copilot). |
| Windsurf / Devin Desktop | Select the actual agent: legacy Cascade and the current Devin Local agent use different configuration and installation paths. See the README's [setup](../README.md#windsurf). |

An AI model being available in an editor does not imply that the model provider
has its own plugin marketplace. These setup formats are distinct from a public
listing or a completed compatibility test on your account.

Kiro's supplied standalone configuration requests only `services:read`. To use
other permissions, the client's authorization request must include the required
scopes before the customer can approve them. The portable Power's OAuth scope
behavior still requires client verification; it is a separate connection.

Mistral Work does not support dynamic tool discovery. After tools change, open
the connector's **Functions → Refresh tools**. Gemini CLI can rediscover tools
with `/mcp reload`; VS Code provides **MCP: Reset Cached Tools**. A tool refresh
does not update installed plugin skills or grant additional OAuth permissions.

## Releases

Plugin bundles contain manifests and skills. The `vpsnet-mcp` npm package
contains the local MCP implementation. Publishing a GitHub commit does not
publish a new npm version or a marketplace listing.

Native bundles use the shared skills from `plugin/skills`; no extra server or
model adapter is needed. Their exact filenames and SHA-256 values are recorded
in `release-manifest.json` by `scripts/package-distribution.py`. Install a
released version rather than assuming a candidate has passed provider review.

The repository-root `skills/` is a generated mirror for Gemini CLI Git installs.
Maintain its selected files with `python3 scripts/sync_gemini_skills.py` after
editing the canonical skills; distribution packaging rejects a stale mirror.

## Official client instructions

- [Mistral Work connectors](https://docs.mistral.ai/vibe/work/connectors/mcp-connectors)
  and [Code CLI authentication](https://docs.mistral.ai/vibe/code/cli/mcp-servers).
- [Perplexity custom remote connectors](https://www.perplexity.ai/help-center/en/articles/13915507-adding-custom-remote-connectors).
- [Qwen Code MCP](https://github.com/QwenLM/qwen-code/blob/main/docs/developers/tools/mcp-server.md).
- [Qwen Code setup](https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/).
- [Gemini browser requirements](https://support.google.com/gemini/answer/17209137).
- [Grok connectors](https://docs.x.ai/grok/connectors).
- [Mistral tool refresh](https://docs.mistral.ai/vibe/work/safety-and-approvals).
- [VS Code MCP formats](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).
- [Devin Local MCP](https://docs.devin.ai/cli/extensibility/mcp/configuration).
