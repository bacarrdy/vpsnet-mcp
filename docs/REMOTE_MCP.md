# Remote AI connections

Connect a supported AI client to `https://mcp.vpsnet.com/mcp` using OAuth.
Sign in to VPSnet, select your services and permissions, then approve the
connection. The AI provider supplies the model under your account's terms;
this connector does not require a model API key.

Provider availability and directory publication are separate release steps.
See the [plugin README](../plugin/README.md) for provider setup and the
[submission checklist](DIRECTORY_READINESS.md) for publisher requirements.

## Permissions

Each request uses the connected customer's authorization. Services and
applications are limited to the selected services. Networking and Functions
permissions apply to the customer's account, as shown during consent.
Existing ownership checks and service locks still apply. Customers can revoke
connections from the AI connections page in their VPSnet account.

The default directory profile manages existing services and excludes purchases,
renewals, payment settings, API-key management, service transfer, model invocation
and infrastructure administration. A separately enabled orders profile can expose
`orders:read`, `orders:servers` and `orders:domains` to approved clients; see
[orders permissions and approval](ORDERS.md). Metadata advertises these three extra scopes only when the gateway’s orders
option is enabled; each client still needs live policy approval and a matching
grant to discover purchase tools. Functions execution uses the existing account’s
VPSnet balance and requires separate `functions:invoke` consent and acceptance
of usage charges. The local stdio client retains its existing API-key
configuration and separate tool profile.

Missing permissions return an OAuth scope challenge before an action runs.
Clients that cannot request incremental consent must reconnect with the needed
permissions. Consent never silently expands an existing grant.

`get_connected_account` reports the stored spending limits returned by the
backend. When supplied, `function_monthly_limit_eur` is the grant's monthly
Functions cap in EUR, alongside `function_daily_limit_eur`; it may be a number
or decimal string. Legacy responses may omit it or return `null`, meaning no
explicit monthly cap is reported by that grant, rather than unlimited usage.
The account's applicable limits still apply. Reading this field does not set
defaults, change an existing grant or authorize `functions:invoke`. Its presence
reflects the connected backend response; client schema support alone does not
prove that a backend change has been deployed.

### Scope descriptions and included access

Authorization-server and protected-resource metadata retain the standard
`scopes_supported` list and add the VPSnet-specific `scope_descriptions` map.
Clients may ignore this extension; the VPSnet consent page displays the catalog’s
localized descriptions, including billing and destructive effects. The authoritative
catalog is backend `app/Services/Mcp/scope-catalog.json`; the gateway vendors it
with `scripts/sync-scope-catalog.py --backend-catalog <path>` (add `--check` to
verify parity). Descriptions never grant permissions.

Manage scopes include the corresponding read scope. `functions:invoke` includes
`functions:read`; `services:rescue` includes `services:read`; `orders:servers` and
`orders:domains` include `orders:read`; `vm:exec` includes `vm:diagnostics`;
`vm:files:write` includes `vm:files:read`; and `dns:write` and `dnssec:manage`
include `dns:read`. `services:restore` authorizes both restoring and deleting
snapshots. The accepted legacy `vm:files` alias includes file read and write,
but is not advertised for new connections. VM permissions also allow the
session and operation-status access needed to carry out their permitted work.

### Why some consent choices are unavailable

The client's authorization request sets the maximum permissions available on
that consent screen. **Diagnose**, **Manage** and **Full access** select only
from the requested scopes; they cannot add permissions the client did not
request. For example, a request for only `services:read` cannot grant file
changes or shell commands, even with Full access selected. To add a permission,
the client must start a new authorization request that includes it and the
customer must approve it. Service access remains limited to the selected
services. A refresh cannot expand the original permissions.

## Reconnect after losing authorization

This workflow applies to remote MCP connections in Codex, Claude Code and web
AI applications that support OAuth. The client's own connection controls and
authentication support determine how it starts the flow.

1. Let the OAuth client refresh an expired access token when it has a valid
   refresh token. An expired access token alone does not require new consent.
   If refresh is rejected because the refresh token expired or was revoked
   (for example, `invalid_grant`), or no usable credentials remain, start a new
   browser authorization flow. Do not repeatedly retry a rejected refresh.
2. Use the application's sign-in or **Reconnect** control where supported. If
   it has no reconnect control, follow its documented procedure to authorize
   the existing MCP connection again. The client discovers the authorization
   server, validates its issuer, and uses the MCP resource
   `https://mcp.vpsnet.com/mcp`. It uses its registered client and callback,
   fresh S256 PKCE and `state`, and requests the permissions needed for the task.
3. Sign in and approve services and permissions on the VPSnet authorization
   page. The client receives the callback, checks `state`, exchanges the code
   using its PKCE verifier, and stores the resulting credentials securely.
   After reconnecting, call `get_connected_account` to verify the granted
   scopes and selected services before resuming work.

For a CLI, a loopback callback must reach the client process. When the CLI runs
on the user's computer, its browser can return to that computer's local
listener. If the CLI runs on a remote machine, use a correctly configured SSH
loopback forward from the user's computer to the remote listener, or a
client-supported, registered HTTPS callback. `127.0.0.1` in the user's browser
refers to the user's computer, not the remote machine. Do not share a loopback
link from another machine or reuse a stale authorization link; start a fresh
flow with a reachable callback.

Web applications use their own registered callback. An assistant can direct
the user to native reconnect controls when available; not every provider lets
an assistant generate a working authorization link. Never ask for passwords,
authorization codes, API keys or tokens in chat, fabricate tokens, or bypass
consent with manually supplied credentials.

Protocol references: [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization),
[OAuth refresh](https://www.rfc-editor.org/rfc/rfc6749.html#section-6) and
[native-app loopback callbacks](https://www.rfc-editor.org/rfc/rfc8252.html#section-7.3).

## VM operations

Delegated Linux VM work supports the VPSnet guest channel and SSH. The guest
channel reaches supported Cloud VPS and Firecracker servers without a public IP
or working guest networking. SSH provides an independent path when available.
Diagnostics, file reading, file changes and shell commands have separate
permissions. Shell commands run as root; a project directory does not limit
their authority. Windows and BSD support covers service management.

| Tool | Result |
| --- | --- |
| `get_connected_account` | Connected account and granted scopes/services |
| `get_update_info` | Public release facts and native update guidance; unknown installed versions stay unknown |
| `open_vm_session` | Authorized guest or SSH session and connection details |
| `inspect_vm` | OS, running services, process names, ports and containers |
| `run_vm_command` | Durable operation ID |
| `read_vm_file` | Bounded text, byte range or tail; SHA-256 for a complete read |
| `create_vm_file` | New file without replacing an existing path |
| `write_vm_file` | Version-checked replacement with a recovery copy |
| `get_vm_operation` | Persisted operation state and result |
| `cancel_vm_operation` | Cancellation request and resulting state |

Keep the same operation key when reconnecting or checking an ambiguous result.
An accepted operation is not proof of completion. Read the final state before
reporting success. Interrupted execution can require attention and is not
replayed automatically. Cancelling a session cannot undo completed changes or
guarantee that every remote child process has stopped.

Guest file operations support up to 32 KiB; SSH supports up to 256 KiB. Replacing
a file requires its complete-read SHA-256. Partial reads cannot authorize a
replacement. A recovery copy is returned after a successful replacement. The SSH
server must support atomic rename. Coordinate other writers when editing files.

SDN changes use customer networking APIs and their operation receipts. Diagnose
missing NAT for internet-dependent work on private servers; the connector does
not automatically purchase a public address or other resources.

## Protocol and local development

The gateway uses Streamable HTTP and OAuth authorization code flow with S256
PKCE, dynamic registration, client-ID metadata documents, resource binding and
rotating refresh tokens. Refresh requests may narrow their original permissions.
IP-loopback callbacks support dynamically selected local ports.
Protected-resource metadata is served at `/.well-known/oauth-protected-resource/mcp`.

Build with `npm ci && npm run build`; the remote entry point is `build/remote.js`.
Generic systemd, environment and nginx examples are in `deploy/`. Keep credentials
out of source control and redact authorization headers and OAuth request bodies
from logs. Never configure a shared customer API key for the remote process.

Run `npm test` and `npm run docs:tools:check` for protocol and tool contracts.
Build the public plugin ZIP with `python3 scripts/package-plugin.py`.
Environment-specific deployment instructions, test accounts and acceptance
reports are maintained privately.
