# MCP resources and guided prompts

The server exposes three static Markdown guides, one JSON scope catalog and four guided prompts.
They add context for clients that support MCP resources and prompts; client
interfaces decide whether and how to show them. Tool discovery, execution,
OAuth permissions and service visibility continue to use their existing rules.

| Resource URI | Contents |
| --- | --- |
| `vpsnet://docs/connection-access` | Connection types, permission boundaries and user authorization |
| `vpsnet://docs/async-operations` | Existing-operation polling, waiting states and separate readiness evidence |
| `vpsnet://docs/read-only-workflows` | Service, network, application and Functions diagnostic reads |
| `vpsnet://docs/oauth-scopes` | All 28 current nonlegacy scopes from the canonical exported catalog, including labels, descriptions, implications and billing categories |

Read these with `resources/list` and `resources/read`. Their content is packaged
guidance, not live customer data or a remote file fetch. Arbitrary URLs and file
paths cannot be read through this resource catalog. The scope catalog is generated
in memory from the packaged canonical catalog without an API call; it documents
supported scopes across discovery profiles and does not claim they are granted
to this connection. Legacy scopes are omitted. HTTP context requests require
the same OAuth authentication as other MCP requests. A local stdio connection
uses the normal management API-key setup.

| Prompt | Intended use |
| --- | --- |
| `review-service` | Review an existing service and distinguish VM, guest and application readiness |
| `review-network` | Review network state and follow existing operation progress |
| `review-application` | Review an existing installation's health, events and bounded logs |
| `review-function` | Review prior invocations without running a function; report configuration evidence limits |

Discover these with `prompts/list` and retrieve one with `prompts/get`. Each
accepts an optional `reference`: an existing identifier, up to 128 ASCII letters,
digits, dots, underscores, colons or hyphens, beginning with a letter or digit.
Omit it to ask the assistant to select a resource from a permitted list.
Retrieval returns a user-role message and makes no customer API call. The
assistant still needs to discover current tool schemas and follow existing
permissions. The templates restrict reviews to tools with `readOnlyHint=true`;
tools named inspect, discover or browse are not assumed read-only. Prompt
selection does not authorize changes or paid execution, and prompts cannot
force a client to follow their instructions. Existing explicit user authorization
remains valid; another confirmation is needed only when an action extends it.
Functions list/get may reconcile saved trace state, so those tools are not
independently certified side-effect free by this guide. A strictly side-effect-free
review must avoid that reconciliation unless already authorized, even if current
annotations have not yet been corrected.

Both catalogs are fixed for each server instance. Initialization declares
`resources: { "listChanged": false }` and
`prompts: { "listChanged": false }`. Resource subscriptions and callback/push
delivery are not offered by the stateless HTTP relay. After a server update,
clients must discover the catalogs again; there is no promised background
notification or client refresh mechanism.

Normal S120 progress, including `in_progress=true`, `reason_kind=waiting`, queued
or waiting-dependency states, remains a successful operation read. Respect the
reported `next_check_seconds`; a 10-second fallback is polling guidance, not a
completion estimate. Return a resumable pending update after six reads instead
of indefinitely blocking or repeating a change. HTTP and authorization failures
remain errors. An operation's terminal failure must be reported from its payload
even when retrieving that operation record itself succeeded.

Unknown JSON-RPC methods use the SDK's standard `-32601` response. Invalid prompt
arguments, missing prompts and malformed resource URIs use `-32602`.
Unregistered resource URIs use the MCP 2025-11-25 recommended `-32002` response,
through a fixed catalog handler rather than the SDK's default `-32602`.
Unsupported subscriptions also return `-32601`; the
server does not add a custom catch-all handler or convert these into tool errors.

For Smithery URL publishing, the [empty configuration schema](../distribution/catalogs/smithery/config-schema.json)
describes the hosted OAuth connection and is passed as publishing metadata with
`--config-schema`. It does not create a configuration endpoint or authenticate a
user. A real OAuth scan, publisher ownership, publication and client-specific
behavior still require separate verification. These local protocol tests do not
prove a Smithery score, an OpenAI rescan or authenticated compatibility for every
client, and adding this source does not deploy it.

Official references reviewed on 2026-10-14:

- [MCP resources, protocol 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)
- [MCP prompts, protocol 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts)
- [MCP lifecycle and capability negotiation](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
- [TypeScript SDK protocol error handling](https://github.com/modelcontextprotocol/typescript-sdk)
- [Smithery URL publishing, scanning and configuration schema](https://smithery.ai/docs/build/publish)

Implementation follows the SDK version in the lockfile. These references do not
claim support for every feature of later MCP protocol revisions.
