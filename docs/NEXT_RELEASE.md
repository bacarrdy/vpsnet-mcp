# Proposed connector 0.6.11 / MCP server 2.3.16

This is an unreleased source candidate based on `396431a` (connector 0.6.10 /
MCP 2.3.15). Version files still identify that existing release until the release
owner prepares the next version. No publication, remote deployment, catalog
propagation, authenticated OpenAI rescan or Smithery scan is implied by these
source changes or local test results.

## Integrated changes

| Reviewed source | Included behavior |
| --- | --- |
| `648aa8c` | Four fixed resources, including all 28 nonlegacy scopes from the canonical catalog; four guided prompts; empty Smithery publishing config schema; protocol tests |
| `7d01dad` | Typed `follow_up` on service reads and permanent-server purchase receipts; same-order/key continuation; bounded polling and readiness evidence |
| `02464ab` | Optional nullable `function_monthly_limit_eur` account-result field and protocol/schema tests |

The integration retains both `registerOrderTools(server, options.remoteScopes)`
and `registerReadOnlyContext(server)`. Resources and prompt retrieval perform no
customer API request. Hosted retrieval retains existing OAuth checks; the scope
catalog documents supported permissions and never represents granted access.
Existing explicit user authorization remains valid. Functions list/get trace
reconciliation is disclosed and is not independently certified side-effect free
by the guidance.

## Tool contract changes

There are no added or removed tools in these three changes. Counts depend on the
discovery profile and the exact scopes supplied to its constructor; they are not
live hosted measurements or a universal count for all clients.

| Local fixture profile | Scope options | Before / after count |
| --- | --- | --- |
| stdio | API-key profile; no remote scope options | 311 / 311 |
| directory | `services:read` | 235 / 235 |
| orders | `services:read orders:read orders:servers orders:domains` | 242 / 242 |

| Tool | Intentional descriptor difference |
| --- | --- |
| `get_service` | Expanded readiness description and an output schema for the added `follow_up` object |
| `get_guest_agent_status` | Description separates KVM/Firecracker guest-agent evidence from VM and application readiness |
| `order_service` (stdio) | Description explains same-order continuation and bounded progress updates |
| `confirm_service_order`, `get_purchase_result` (orders profile) | Financial/provisioning descriptions and typed optional `follow_up` output |
| `get_connected_account` (hosted) | Optional nullable monthly Functions limit in the output schema |

Input schemas, required scopes and OAuth security declarations are unchanged by
these three source changes. Tool annotations are also unchanged by them;
separately reviewed metadata corrections must be described distinctly before
the complete release candidate is frozen.

The only tool-result error classification change is narrow: a pending financial
receipt with its original matching key and validated continuation remains pending
even when its legacy body contains `success:false`. Explicit error fields and
HTTP failures retain precedence. Ordinary S120 waiting remains nonfailure.
Nothing automatically resubmits an order, creates another idempotency key,
restarts a VM, grants a scope or schedules a callback.

Financial acceptance, VM provisioned/running, guest capability and application
health remain separate observations. Suggested ten-second polls are intervals,
not ETAs. After six checks, return a pending progress update with the original
identifiers so the user can resume. Operator attention and observed creation
failures must be reported without blind retries.

## Backend and release boundaries

The monthly Functions field is forward-compatible with the separately reviewed
backend change. A stored null or omitted field does not mean unlimited usage;
account policy still applies. This MCP change does not activate backend financial
policy, migrate grants or expand any connection's service selection.

The release owner must freeze the combined reviewed source before preparing
versions and artifacts. Source/tag/artifact publication, hosted deployment,
official registry publication, downstream catalog propagation and client OAuth
verification are distinct states. Local package validation does not complete
those external stages.

## Validation

Run with the lockfile dependency tree (SDK 1.32.1), including `npm test` and
`npm run docs:tools:check`. Protocol checks cover launched stdio, authenticated
fixture HTTP, resource and prompt discovery/errors, unchanged OAuth boundaries,
pending receipts, missing permissions, and Firecracker/KVM/Windows readiness
fixtures. Package validation must include both `build/read-only-context.js` and
`build/service-readiness.js`.

Full emitted-tool descriptor snapshots and the separately reviewed annotation
changes are to be included before final combined approval. The release owner
records the final source commit and verification receipt; this proposal makes no
claim that OpenAI or another catalog has approved or rescanned the candidate.
