# Prepared connector 0.6.11 / MCP server 2.3.16

Prepared on 2026-10-14 from frozen combined source `ed5fc9b`, based on `396431a`
(connector 0.6.10 / MCP 2.3.15). Version files now identify the local candidate
0.6.11 / 2.3.16; the publication feed remains at the last verified 0.6.10 /
2.3.15. Final combined independent review is required before publication.
No publication, remote deployment, catalog
propagation, authenticated OpenAI rescan or Smithery scan is implied by these
source changes or local test results.

## Integrated changes

| Reviewed source | Included behavior |
| --- | --- |
| `648aa8c` | Four fixed resources, including all 28 nonlegacy scopes from the canonical catalog; four guided prompts; empty Smithery publishing config schema; protocol tests |
| `7d01dad` | Typed `follow_up` on service reads and permanent-server purchase receipts; same-order/key continuation; bounded polling and readiness evidence |
| `02464ab` | Optional nullable `function_monthly_limit_eur` account-result field and protocol/schema tests |
| `281a32c` | Complete missing legacy stdio impact hints and top-level titles while retaining authored values and hosted descriptors |
| `3427d39` | Separate intentional correction of five hosted impact annotations for confirmed reconciliation effects |
| `3060f83` | Exact emitted tool contract snapshots, independent impact-policy fixture and CI drift checks |

The integration retains both `registerOrderTools(server, options.remoteScopes)`
and `registerReadOnlyContext(server)`. Resources and prompt retrieval perform no
customer API request. Hosted retrieval retains existing OAuth checks; the scope
catalog documents supported permissions and never represents granted access.
Existing explicit user authorization remains valid. Functions list/get trace
reconciliation is disclosed and is not independently certified side-effect free
by the guidance.

## Tool contract changes

There are no added or removed tools in the combined candidate. Counts depend on the
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

Input schemas, required scopes and OAuth security declarations are unchanged.
The resources, async and monthly-field changes do not alter annotations. The
separate stdio metadata completion adds missing top-level titles to 311 tools
and completes missing fields in 166 annotation objects while preserving authored
values. Its hosted descriptors remain unchanged. The independently reviewed
hosted correction changes exactly these five tools:

| Hosted tool | Previous read-only / destructive | Corrected read-only / destructive |
| --- | --- | --- |
| `list_snapshots` | true / false | false / true |
| `get_hostname` | true / false | false / true |
| `list_functions` | true / false | false / false |
| `get_function` | true / false | false / false |
| `create_domain_contact` | false / false | false / true |

The confirmed effects and backend evidence are documented in
[the tool-contract guide](TOOL_CONTRACTS.md). These hints do not change handlers
or grant permission. Existing read-scoped endpoints can perform reconciliation;
read scope and HTTP GET alone do not certify side-effect-free behavior.

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

The combined source was frozen before this local version preparation. The release
owner must approve the final combined review before publication.
Source/tag/artifact publication, hosted deployment,
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

Full emitted-tool descriptor snapshots include the separately reviewed annotation
changes and the approved async/monthly output contracts. Snapshot refresh was
explicitly requested with a review reason; CI compares exact emitted descriptors
and cannot regenerate its own expectations. The release owner records the final
source commit and verification receipt; this proposal makes no
claim that OpenAI or another catalog has approved or rescanned the candidate.
