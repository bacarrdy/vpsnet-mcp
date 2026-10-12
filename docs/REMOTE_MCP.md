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

The remote profile manages existing services. Billing, ordering, renewal,
API-key management, service transfer, model invocation and infrastructure
administration are excluded. The local stdio client retains its existing API-key
configuration and separate tool profile.

Missing permissions return an OAuth scope challenge before an action runs.
Clients that cannot request incremental consent must reconnect with the needed
permissions. Consent never silently expands an existing grant.

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
