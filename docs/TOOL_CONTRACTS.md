# Reviewed tool contracts

Reviewed 2026-10-14; updated 2026-10-18 for the service file manager and VPN site-to-site tools (2.4.0); updated 2026-10-26 for the `reinstall_os` credential contract (2.4.1: no `rootPassword` on the directory profile, `sshKey`/`rootPassword` mutually exclusive elsewhere); updated 2026-10-26 for the Managed Applications server-routes tools (2.5.0). These are emitted server contracts, not a claim that a client or directory has refreshed or approved them.

| Fixture | Discovery context | Tool count |
| --- | --- | ---: |
| `stdio` | General local server, API-key transport | 333 |
| `directory` | Remote profile, `services:read` | 254 |
| `orders` | Remote orders profile, `services:read orders:read orders:servers orders:domains` | 261 |

OpenAI uses the remote directory contract; there is no separately implemented OpenAI profile. The HTTP gateway selects the orders profile only from the issuer's live ordering decision and actual granted order scopes. The fixture scope contexts are explicit because an orders-only subset or different VM scopes can affect discovery/security metadata. The counts above are not a universal client limit or a count observed in an authenticated Claude/OpenAI session.

## CI and intentional updates

`npm test` already runs `test/*.test.mjs` in the Node 20/22 GitHub Actions matrix. The new tests discover real SDK descriptors and compare the complete name set, titles, descriptions, annotations, input/output schemas, and security metadata. A raw HTTP test checks the same descriptors and canonical/compatibility security declarations; its only backend requests are mocked OAuth introspections. It does not call customer tools.

Run:

```sh
npm run build
node scripts/tool-contracts.mjs --check
```

`test/fixtures/tool-contracts/stdio.json` contains full descriptors. `directory.json` and `orders.json` store exact inclusion lists and descriptor overrides against the preceding profile to avoid duplicating identical schemas. Expansion reconstructs the full descriptor, including removed fields. It never inherits a newly added base tool unless that tool is explicitly included.

For an intentional change, review the handler and relevant backend effects, update the independent impact policy where applicable, and describe compatibility and any removals in the changelog. Then run explicitly:

```sh
node scripts/tool-contracts.mjs --update "issue reference and reviewed contract change"
git diff -- test/fixtures/tool-contracts
npm test
```

The update command requires a review reason and refuses to run in CI. Generated snapshots are evidence for code review; generating them does not approve or publish a tool. CI never rewrites or silently accepts drift. The negative cases cover renamed/removed tools, changed titles/descriptions/annotations, input/output schemas, OAuth declarations, missing required metadata, and profile leakage.

## Impact policy

[The independent effect fixture](../test/fixtures/tool-contracts/impact-policy.json) cites operation behavior and backend traces. A tool name, HTTP verb, read scope, or a matching snapshot alone cannot establish read-only behavior. A pure POST price calculation remains read-only; durable quotes, browse jobs and guest inspections are writes even when no charge or source-file modification occurs. Incidental access/audit logs and observation-cache refresh alone are distinguished from customer lifecycle changes and persisted jobs.

`browse_restore_files` is explicitly `readOnlyHint=false`, `destructiveHint=false`: it persists a browse request and queues work, while leaving backup contents and the running server unchanged and charging nothing. `get_restore_file_browse` reads the stored result. The policy tests protect this distinction.

Legacy stdio completion fills previously missing metadata and preserves authored fields. The separate intentional hosted correction changes only these impact hints:

| Tool | Previous read-only / destructive | Corrected read-only / destructive | Confirmed effect |
| --- | --- | --- | --- |
| `list_snapshots` | true / false | false / true | Can finish pending rollback reconciliation, including disk/application changes. |
| `get_hostname` | true / false | false / true | Can reserve/reconcile a platform hostname and queue DNS/PTR/guest work. |
| `list_functions` | true / false | false / false | Can create/repair hidden billing-anchor bookkeeping; does not delete code or customer resources. |
| `get_function` | true / false | false / false | Same hidden-anchor repair boundary. |
| `create_domain_contact` | false / false | false / true | Optional `is_default` replaces the previous default contact. |

These corrections change no tool names, descriptions, schemas, handlers, scopes or runtime authorization. Hints describe effects; they do not grant new rights. The backend traces were reviewed against commit `80bbca6c48222c5d260bd2e721ceb56aa756ffd3`; the fixture records the relevant paths.

## Compatibility and publication

Do not remove or rename a tool without an explicit changelog entry, replacement/migration instructions, and a reviewed plan for cached client definitions. When a compatible alias can be retained safely, keep its original authorization and input contract while hiding it from new discovery if appropriate. Incompatible input/output changes need the same review. Existing remote aggregate aliases (`manage_application`, `manage_free_certificate`, `manage_automatic_ssl_subscription`, `manage_certificate`) remain callable for cached clients and are omitted from remote discovery; this change removes no tools or aliases.

After deployment, an OpenAI publisher can request a rescan and inspect live versus held metadata. Eligible hosted changes pass automated checks; newly added tools await approval, and held changes can retain the previous definition. Scan controls can be unavailable. Maintain compatibility with the live approved schema until the replacement is live. Package/skill changes need a separate package update. [Official submission/update guidance](https://developers.openai.com/plugins/deploy/submission), checked 2026-10-14.

Claude documents dynamic/on-demand tool access for larger connector libraries. Its API tool-search limits are a separate product contract; neither source establishes a universal fixed consumer-directory tool count. No authenticated Claude or OpenAI publisher scan was available in this audit. Local SDK/HTTP tests do not prove a directory refreshed. [Claude tool access](https://support.claude.com/en/articles/13730515-manage-claude-s-tool-access), [API tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool), checked 2026-10-14.

[The publication record](../distribution/releases/published.json) records the latest independently verified artifacts, separately from prepared source versions. As of the 2026-10-26 verification, it records plugin `0.6.14` (public ZIP digest verified) and MCP `2.3.16`; MCP `2.4.1` is released from source but not yet published to npm or recorded there. This proves the recorded public artifact, not OpenAI/Claude approval, registry synchronization or every gateway's deployed version. [Verified plugin release](https://github.com/bacarrdy/vpsnet-mcp/releases/tag/plugin-0.6.14).

A provider's generic "further review" finding does not identify a schema or annotation defect. Record the exact tool and live/held state, compare its raw descriptor with the previously scanned version, and ask for the specific review requirement. Do not change an impact hint or bump the server version merely to hide a review hold. OpenAI and Claude share the directory profile; preserve that contract until an intentional, reviewed change is ready.
