# Single-skill imports

The generated folders under `distribution/standalone-skills/` contain four
self-contained skills: `vpsnet-operations`, `vpsnet-deploy`,
`vpsnet-troubleshoot` and `vpsnet-functions`. Each folder has `SKILL.md` at its
root and includes its required references. They contain instructions only;
connect the client's native MCP integration separately to
`https://mcp.vpsnet.com/mcp` with customer OAuth.

For a client that imports one GitHub skill folder, select the corresponding
`distribution/standalone-skills/<skill>` directory at the reviewed release ref.
For a client that accepts a single-skill ZIP, use the corresponding
`<skill>-<plugin-version>.zip` from the distribution build. Lovable and Bolt
document GitHub/file imports. ClawHub and Hermes support skill distribution
through their own publishing or repository workflows. Package validation does
not prove a provider login, public listing approval or live client acceptance.

These exports derive from `plugin/skills/`; do not edit the generated copies.
After changing canonical skills, regenerate and validate both mirrors:

```sh
python3 scripts/sync_plugin_version.py
python3 scripts/sync_gemini_skills.py
python3 scripts/sync_standalone_skills.py
python3 scripts/sync_standalone_skills.py --check
python3 scripts/package-distribution.py
```

The dependency map selects only the reviewed skill and reference files. The
three sibling execution-reference links are rewritten to
`references/execution.md`; their instruction text and reference contents are
preserved. Local links must resolve inside each skill. Extra files and links do
not cause additional files to be included. Stale generated copies and symlinks
fail validation. ZIP entries have fixed timestamps and permissions, and their
asset names and manifest versions follow the current plugin version.

Each skill also carries `references/plugin-version.json`, generated from
`release-config.json`. Its `plugin_version` identifies the installed skill
release for the read-only first-use `get_update_info` check. Plugin release
preparation regenerates this reference and both skill mirrors; validation and
packaging reject stale copies. It does not identify the host application's
version or the currently deployed gateway.

The release build adds four single-skill ZIPs alongside the existing five
client bundles. It does not update installed copies. For Bolt, a GitHub import
is a snapshot: import the newer skill and remove the outdated version. Other
clients' update and publishing behavior must be checked in their own workflow.

Format references: [Lovable skills](https://docs.lovable.dev/features/skills),
[Bolt skills](https://support.bolt.new/building/skills),
[ClawHub publishing](https://docs.openclaw.ai/clawhub/quickstart),
[Hermes skills](https://hermes-agent.nousresearch.com/docs/developer-guide/creating-skills).
