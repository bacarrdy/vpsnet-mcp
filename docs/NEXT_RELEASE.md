# MCP server 2.7.4

Published 2026-11-24. The connector stays at 1.0.1 (no connector or ZIP change).

## Release notes

MCP server **2.7.4**:

- Installing an application never restarts the server and asks for no consent: `install_application`, `install_application_recipe` and `confirm_application_compose_adoption` no longer have `acknowledge_runtime_restart`, and `list_application_catalog` says that `target.install_requirements.runtime_restart_consent.required` is always false.
- Server firewall: `set_service_public_firewall` takes `ingress_policy` (`drop` or `accept`, the default for new incoming connections) and an `action` (`accept` or `drop`) on every rule; rules are checked from top to bottom and the first one that matches decides. `get_service_public_firewall` describes `ingress_policy`, the rule actions and `actions.available`. A firewall saved in the panel with the default `accept` or a drop rule can be changed through MCP again. Local package: 370 tools.

Hosted connector: the same changes reach it when the gateway runs 2.7.4. See [CHANGELOG](../CHANGELOG.md).

## Required release checks

- `npm ci`, `npm test` (Node 20 and 22) and `npm run docs:tools:check` pass on the exact commit.
- `python3 scripts/release.py build --component mcp` passes, including **the packed tarball answers through its bin** (`node_modules/.bin/vpsnet-mcp`, `npx --no-install vpsnet-mcp`, `npx -y --package=<tarball> vpsnet-mcp`, `vpsnet-mcp-http`).
- Publish exactly the tarball that check ran on; compare its sha256 with the registry download afterwards.
