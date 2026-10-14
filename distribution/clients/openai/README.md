# ChatGPT and Codex

VPSnet uses the portable root `plugin.json` and `mcp.json` format supported by
ChatGPT and Codex. The plugin bundles task skills and connects to
`https://mcp.vpsnet.com/mcp` with OAuth. VPSnet does not need a model API key.
Public directory publication, workspace policy and account eligibility determine
which installation options appear. See [OpenAI's packaging guide](https://developers.openai.com/plugins/build/plugins).

## Codex marketplace installation

The repository includes an OpenAI marketplace catalog at
`.agents/plugins/marketplace.json`, pointing to `./plugin`. For Git installation:

```sh
codex plugin marketplace add bacarrdy/vpsnet-mcp --ref main
codex plugin add vpsnet@vpsnet
```

For a local checkout, add its repository root instead:

```sh
codex plugin marketplace add /absolute/path/to/vpsnet-mcp
codex plugin add vpsnet@vpsnet
```

Use one source for a given installation. Complete the native OAuth connection
flow and start a new session before using bundled skills. The CLI's `/plugins`
browser also supports installing and managing configured marketplace plugins.
See [CLI commands](https://learn.chatgpt.com/docs/cli/reference) and
[plugin usage](https://learn.chatgpt.com/docs/plugins).

## Update a Codex marketplace installation

For a configured Git marketplace named `vpsnet`:

```sh
codex plugin marketplace upgrade vpsnet --json
codex plugin list --json
```

Check the command results and the installed and available versions, then start a
new session. A Git source pinned to a fixed commit will stay at that revision;
use a moving branch when you want future repository updates. For a local
marketplace, update its source checkout first. In the ChatGPT desktop app,
restart the app after changing local plugin files so the installed copy can
refresh. See [marketplace refresh and local development](https://developers.openai.com/plugins/build/plugins#add-a-marketplace-from-the-cli).

## Refresh a custom ChatGPT MCP connection

For an MCP server added directly in ChatGPT, after tools or metadata change:

1. Open [ChatGPT Plugins](https://chatgpt.com/plugins).
2. Select the existing VPSnet connection and choose **Refresh**.
3. Verify the advertised tools and permissions.
4. Start a new conversation and test the affected task.

This refresh updates custom connection metadata. A published directory plugin
uses OpenAI's separate review process. See
[custom MCP refresh](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata).

## Workspace GitHub marketplaces

An administrator can import this repository's OpenAI marketplace through
**Admin → Plugins → Add → Import marketplace**. Use the repository URL and,
for future updates, a moving branch such as `main`. New marketplace imports
have daily automatic sync enabled. To check sooner, open
**Admin → Plugins → Marketplaces**, select the source, and choose **Sync now**.
Inspect the sync report; an invalid update can retain the last working version.
Workspace imports and local Codex marketplaces have separate policies and
update controls. See [workspace marketplace management](https://learn.chatgpt.com/docs/enterprise/plugin-management).

## Published directory updates

The publisher deploys compatible MCP server changes and can request **Rescan**
under the plugin's **MCPs → connected server → Issues**. OpenAI also scans hosted
servers daily; an update can remain held while the previous approved metadata
stays live. The server must remain compatible with that definition.

Changes to bundled skills, listing metadata or assets require a complete new
package version, applicable review and publication. Deploying a newer MCP
server does not replace those bundled files. See
[published plugin updates](https://developers.openai.com/plugins/deploy/submission#update-your-published-plugin).

## Reconnect or approve another permission

Refresh and package updates do not grant more access. Use the application's
native OAuth flow when the connection expires or a task needs another scope.
Normal token refresh can reuse existing authorization; if refresh is rejected,
a new authorization flow is needed. Approve only the services and permissions
needed for the task, then inspect `get_connected_account` before resuming.
Never share passwords, OAuth codes or tokens in the conversation.

For a **direct Codex MCP entry** named `vpsnet`, the documented CLI flow is:

```sh
codex mcp login vpsnet --scopes services:read,vm:exec
```

That example requests server viewing and command execution; choose the actual
scopes needed. A plugin-managed connection can use a different internal name,
so follow its native connection controls. See
[Codex OAuth](https://learn.chatgpt.com/docs/extend/mcp#oauth-client-registration)
and the [VPSnet reconnect guide](../../../docs/REMOTE_MCP.md#reconnect-after-losing-authorization).

## Release checks and notifications

The MCP initialization version identifies the running server build; the plugin
manifest version identifies bundled files. A host application's version does
not identify the installed VPSnet bundle. An existing chat may retain its
loaded tools and skills, so use the refresh and new-session steps above when
checking changed behavior. VPSnet currently has no plugin-release notification
subscription or automatic installer.

OpenAI's optional [MCP Events](https://developers.openai.com/plugins/build/mcp-events)
can run user-requested monitoring in Work chats on web, desktop Work with Cloud,
and dots. It requires a separate MCP 2.0 event/subscription/webhook implementation;
it does not force plugin installation or reload an existing chat. Ordinary
[ChatGPT activity notifications](https://learn.chatgpt.com/docs/notifications)
report chat activity and are separate from plugin update controls.
