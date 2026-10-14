# Updates and releases

The hosted MCP gateway, a plugin's installed skills, a local npm MCP server and
a provider's catalog are separate components. Updating one does not prove the
others changed. VPSnet maintains the hosted gateway; users update local packages
through their AI application's native controls. Neither an update nor metadata
discovery adds OAuth permissions.

## Check explicitly

From a trusted checkout of this repository:

```sh
python3 scripts/check-updates.py --client claude-code --plugin-version 0.6.9
python3 scripts/check-updates.py --client codex --plugin-manifest plugin/plugin.json
python3 scripts/check-updates.py --client generic --local-mcp-manifest package.json
```

Use the manifest belonging to the actual installation, not a newer downloaded
checkout. Versions passed as flags are labeled `caller_reported`; an explicitly
supplied matching manifest is labeled `local_manifest`. Missing, malformed or
unavailable versions stay unknown. A host's MCP `clientInfo.version` identifies
the AI client, not the installed VPSnet plugin. The checker does not scan local
plugin stores or infer versions from that host field.

The result compares plugin, local MCP and caller-reported gateway versions
independently. `update_available` is `true`, `false` or `null` (unknown).
Compatibility remains unknown without version-specific acceptance evidence;
a newer version alone is not an incompatibility. Gateway notices say that VPSnet
maintains the server, rather than directing users to upgrade npm to change it.

`distribution_status` separates `source_release_published` from
`npm_package_published`. It leaves `remote_deployment_status`, official MCP
registry version/check time and downstream catalog status unknown unless
separate evidence is available. An unknown deployment status does not mean the
gateway is undeployed. The version checker is not the release preparation CLI
and does not perform publication or catalog synchronization.

The checker reads only the fixed first-party published-release feed, accepts at
most 64 KiB, uses a five-second socket timeout and refuses redirects. A socket
timeout is not a strict total elapsed-time deadline. An unavailable or invalid
feed yields an advisory unknown result. It never installs, executes commands,
changes credentials, reconnects or requests scopes. Release-body prose is not
accepted. Client instructions are reviewed local data, not remotely supplied
commands. No schedule, startup hook or repeated notice is installed.

## Native client controls

For ChatGPT and Codex, see the [OpenAI client guide](../distribution/clients/openai/README.md).
For other surfaces, see [AI client setup](CLIENTS.md). The checker's
[reviewed instruction registry](../scripts/update-clients.json) includes dated
official references and leaves undocumented refresh behavior unknown.

Claude Code's marketplace plugin update and `/reload-plugins` update installed
files and the current session respectively. Claude account plugins use their
source's update controls. Grok's guide documents custom connector discovery but
does not establish a plugin ZIP update or tool-cache refresh command.
See [Claude Code updates](https://code.claude.com/docs/en/discover-plugins),
[Claude account plugins](https://claude.com/docs/plugins/overview) and
[Grok connectors](https://docs.x.ai/grok/connectors).

MCP `notifications/tools/list_changed` concerns live discovery; it does not
replace plugin skills or local npm files. The current VPSnet gateway is stateless
and returns JSON per request, with no retained notification stream. It does not
automatically push deployment or plugin-update notices into existing sessions.
Client refresh, reconnect and session reload are distinct; use the documented
control for the active client and installation source.
See [MCP tool discovery](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

## Prepare a release

[release-config.json](../release-config.json) is the single source for desired
plugin and npm versions. Their versions remain independent. Commands run from
the repository root and perform no publication or deployment:

```sh
python3 scripts/release.py plan --component plugin --version 0.6.10
python3 scripts/release.py prepare --component plugin --version 0.6.10
python3 scripts/release.py validate
python3 scripts/release.py build --component plugin
```

`prepare` requires an explicit increasing stable version and updates all seven
connector manifests together. It preserves review cases, commerce metadata,
OAuth configuration and npm versions. Use `--component mcp --version VERSION`
for an independent npm update; this preserves connector versions and changes
only the package/lock versions and release configuration. Review the resulting
diff and write accurate changelog/release notes separately.

`validate` checks source version consistency, public package boundaries, the
published-feed schema and the Gemini skill mirror when present. It does not
claim that source changes are published or accepted by providers. `build` uses
the existing explicit distribution allowlist for five client bundles and four
self-contained single-skill ZIPs. For npm,
install dependencies using `npm ci --ignore-scripts`, then the wrapper builds
and packs with lifecycle scripts disabled. Built artifacts are marked unpublished.
Never upload a modified bundle under an already published version.

Run `npm test` and `npm run docs:tools:check`, review the exact commit, and wait
for its contract CI on Node 20 and 22. Publish the exact reviewed artifacts;
verify public downloads and checksums rather than rebuilding after approval.
SHA-256 identifies bytes; these manifests do not claim cryptographic signatures
or signed build provenance. Publisher authentication and catalog review remain
separate, explicit release steps.

## Record published facts

[distribution/releases/published.json](../distribution/releases/published.json)
records independently verified published plugin and npm artifacts. It is not
generated from desired source versions. The initial entries are actual plugin
0.6.9 and npm 2.3.14 releases, verified against public artifact bytes, package
manifests and successful contract CI heads.

After an authorized publication and a verified private receipt:

```sh
python3 scripts/release.py record-published --component plugin --receipt /path/to/plugin-receipt.json
python3 scripts/release.py record-published --component mcp --receipt /path/to/npm-receipt.json --ci-run EXACT_RUN_ID
```

This command does not upload or publish. It takes only approved public fields
from the receipt, checks the canonical artifact URL, downloads and verifies its
SHA-256 and package version, and checks the successful contract workflow at the
exact source commit. It refuses rollback or replacement of an existing version's
identity. Failures leave the feed untouched. Review and commit the public feed
update separately; private receipts stay outside the repository.

The public feed schema is `schema_version: 1` plus `plugin` and `mcp` entries.
Each has `version`, `source_commit`, `verified_at`, canonical `url`, `sha256`,
`ci_run` and `ci_conclusion: "success"`. Stable versions only; unknown fields,
duplicate keys, unexpected URLs and release prose are rejected by the checker.
This binds checksums to reviewed release facts, not to installed client versions
or provider catalog approval. Provider-specific submission, synchronization and
review are recorded separately and are not implied by a GitHub release.
