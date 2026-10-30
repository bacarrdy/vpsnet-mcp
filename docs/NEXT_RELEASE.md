# Connector 0.6.16 / MCP server 2.6.0

Prepared October 30, 2026. Backend comparison: `c506653d` through
`779254fe25961acd2f3360770756647f5d689def`, using customer routes, controllers
and contract services; the backend root changelog is incomplete for this period.
See [CHANGELOG](../CHANGELOG.md) and [DNS correction](DNS_ZONE_REVIEW.md).

## Included

- Truthful DNS restoration/publication effects and destructive hint; strict
  native-only hosted input; local secondary support retained.
- Capability-gated IPsec site-to-site inputs, public router recipe read,
  explicit device grant scope and protocol-specific health guidance.
- Catalog-selected terms on existing local network quote tools, without
  expanding hosted purchase capabilities.
- Corrected bundled skills and OpenAI review cases/release notes.
- Earlier source changes since the last npm publication, 2.3.16, remain included.

## Publication and deployment evidence

Source versions, GitHub releases, npm tarballs, hosted runtime and OpenAI review
are separate. Record publication receipts only after validating actual public
bytes and exact-source CI. The production gateway observed before this update
still ran 2.4.1 (`eb957787983a44cf7d1d64924047a0b95735ee63`), while GitHub's latest
plugin was 0.6.15; prepared 2.5.0 artifacts did not prove production activation.

Use `vpsnet-plugin-0.6.16.zip` for the existing OpenAI plugin. The generic
`vpsnet-agent-plugin` ZIP deliberately removes OpenAI-specific metadata.
A ZIP cannot update a remote tool schema: deploy the tested server, verify its
tools/list metadata, then refresh the existing OpenAI submission. The generic
further-review finding does not identify a violated rule or guarantee acceptance.
Reviewer-account cases and provider approval are separate from local synthetic tests.

## Deliberate exclusions

No App Cloud activation; no API-key-forbidden WHOIS privacy write; no raw TSIG
or PSK input in hosted DNS/VPN tools. New VPN restart/rebuild and payment-receipt
helper endpoints remain outside this release's MCP surface. Their absence is
not a promise that all current backend capabilities are exposed.

## Required release checks

Run the full npm tests, generated tool reference check, reviewed three-profile
contract snapshots and release validation. Require Node 20 and 22 GitHub CI on
the exact release commit, inspect final archives and verify published hashes.
Hosted activation keeps existing OAuth, service and proxy configuration and
retains the previous immutable runtime for rollback.
